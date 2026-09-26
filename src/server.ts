import { routeAgentRequest, type Connection } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText
} from "ai";
import { createTriageModel } from "./models/triage-model";
import type { IncidentCard } from "./models/incident";
import { createIncidentTools } from "./tools/incident-tools";

type TriageAgentState = {
  incident: IncidentCard | null;
};

export class TriageAgent extends AIChatAgent<Env, TriageAgentState> {
  initialState: TriageAgentState = { incident: null };
  maxPersistedMessages = 100;
  chatRecovery = true;

  validateStateChange(_nextState: TriageAgentState, source: Connection | "server") {
    if (source !== "server") {
      throw new Error("Incident state can only be changed by the server");
    }
  }

  private loadIncidentTicket(): IncidentCard | null {
    return this.state.incident;
  }

  private saveIncidentTicket(incident: IncidentCard): void {
    this.setState({ ...this.state, incident });
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const currentIncident = this.loadIncidentTicket();
    if (currentIncident?.status === "resolved") {
      return new Response(
        "This incident is closed. No further chat is available for this incident.",
        { headers: { "content-type": "text/plain; charset=utf-8" } }
      );
    }

    const model = createTriageModel(this.env.AI, this.sessionAffinity);

    const result = streamText({
      model,
      temperature: 0.25,
      maxOutputTokens: 1024,
      system: `You are Triage Agent, an incident-management triage assistant. Analyze symptoms, logs, and evidence supplied by the user. You cannot inspect their environment or take actions unless an available tool explicitly does so. Never imply otherwise.

    ${currentIncident ? `Current persisted incident ticket (authoritative stored state; update it when new user evidence changes the assessment):\n${JSON.stringify(currentIncident)}` : "No incident details yet."}
    
    Talk like a calm, experienced on-call colleague: plain sentences, no jargon about yourself.
    Never mention tools, function calls, or updates to the incident card in your replies.
    If the message is a greeting or small talk, reply in one short friendly line and ask what's going on, for example to paste logs or describe the symptom. Don't call any tools.
    Only call incident tools when the user shares incident details or asks to close the incident.
    Use the full structured answer only for the first assessment of an incident; after that, reply conversationally in a few sentences.

    For every incident, connect the timeline/activity to the observed evidence before recommending action. Structure your response in this order:
    1. **Most likely cause:** Put your leading hypothesis in the very first line. State confidence (high, medium, or low) and cite the specific evidence.
    2. **Activity-to-evidence link:** Explain what happened before or during the incident, what changed afterward, and how the evidence supports (or fails to support) a causal link. Distinguish correlation from proof. Check timestamp ordering carefully; never say an event happened before another if the supplied times contradict that.
    3. **Other likely causes:** Give the next one or two plausible hypotheses, one per line, ordered by likelihood. For each, tie the hypothesis to evidence and explain whether it could be a root cause, contributing factor, or downstream symptom. Do not present guesses as confirmed facts.
    4. **Safest next actions:** Recommend practical, ordered diagnostic checks that test the leading hypothesis and alternatives. Prefer reversible, low-risk verification first (compare error rates by version/region, inspect deployment diff and health metrics, correlate traces/request IDs, check DB pool and upstream latency). State what result would support or weaken each hypothesis. Suggest rollback only when evidence indicates the activity/release is implicated and impact justifies it; frame it as a controlled mitigation, mention risks, and defer to the incident owner/runbook. Never jump to undoing the latest activity merely because it is recent.
    5. **Impact and escalation:** Describe the plausible impact based on the evidence, clearly marking unknown scope. Recommend prompt escalation to the appropriate on-call, incident-response, security, or service owner when impact is severe, spreading, affects sensitive data or safety, or cannot be safely contained. Do not invent an organization's severity definitions or response-time commitments.
    6. **Assumptions and questions:** Explicitly list assumptions you made. Ask only for missing information that would materially change the diagnosis or next action (for example, exact deploy start/finish time, whether errors began before or after deploy, version/region breakdown, affected users/payment methods, recent config or traffic changes, and relevant surrounding logs). If evidence is insufficient, say so and avoid false precision.

    Be concise and calm. Separate observations from inferences.  Always check what changed recently (deploys, config, traffic, dependencies) and whether it affects one instance or all of them.
    For follow-up messages, answer directly and only repeat the full structure when new evidence changes the diagnosis.
    After each message with new evidence, call updateIncident with only what changed, and record every hypothesis you mention, not just the leading one. Then answer the engineer directly: say what the new evidence means for the diagnosis and the next step, with mitigation first if users are still affected. Never describe the tool call or the ticket changes; the engineer can see the card.
    To close an incident, call closeIncident; the engineer must approve it. Only say the incident is resolved after that tool succeeds. Once an incident is resolved, no further chat or ticket updates are allowed for it.`,
      // Prune old tool calls and reasoning to save tokens on long conversations
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      tools: {
        ...createIncidentTools({
          load: () => this.loadIncidentTicket(),
          save: (incident: IncidentCard) => this.saveIncidentTicket(incident)
        })
      },
      stopWhen: stepCountIs(8),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;