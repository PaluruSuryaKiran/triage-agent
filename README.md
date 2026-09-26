# Triage Agent

A small incident triage assistant running on Cloudflare. You paste logs or describe what's broken, and it tells you the most likely cause, a couple of other possibilities, and what to check next. While you talk to it, it keeps an incident card up to date: severity, hypotheses (active, confirmed or ruled out) and next actions. Closing an incident needs a human to approve it.

Live demo: `https://triage-agent.suryakiran.workers.dev`

## Assignment checklist

- **LLM:** Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) on Workers AI
- **Coordination:** one Durable Object per incident, using the Agents SDK's `AIChatAgent`
- **User input:** chat UI
- **Memory / state:** chat history plus the incident card, both stored in the incident's Durable Object

## What I built, and what came from the starter

I started from Cloudflare's [agents-starter](https://github.com/cloudflare/agents-starter) template, following the Agents quick start. The starter gave me the React chat UI, the connection between the browser and the agent, saving chat messages, rendering tool calls in the chat, and the approve/reject buttons for tools that need approval.

On top of that, I:

- switched the model to Llama 3.3, since the starter's default model isn't available on the free plan
- wrote the triage system prompt and tuned it through testing
- designed the incident card and wrote the `updateIncident` and `closeIncident` tools
- stored the card in the agent's state and fed it back into the prompt on every turn, so the model can see what's already recorded
- gave each incident its own Durable Object, using an ID in the URL (`?incident=<id>`) and a "New incident" button
- worked around a streaming bug in the Workers AI provider (see Known issues)
- added unit tests for the incident tools
- removed the starter parts I didn't need: demo tools, scheduling, MCP and image uploads

## How the incident card works

The model doesn't write to storage directly. When it learns something, it calls `updateIncident` with only the fields that changed. My code validates the input with Zod, applies it to the card and saves it with `setState`.

A few rules I added along the way:

- Hypothesis IDs (`h-001`, `h-002`, ...) and timestamps are set by the code, not the model. The model refers to hypotheses by those IDs in follow-ups.
- The schemas are strict. If the model sends an unknown field or a bad value, the tool returns the error so the model can correct itself and retry. Formatting differences like `"High"` vs `high` are simply normalised.
- Marking a hypothesis `ruled_out` or `confirmed` needs a reason, and a ruled-out one can only come back with new evidence.
- `updateIncident` can't close an incident. Only `closeIncident` can, and it waits for approval in the UI. After that, the card can't change and the chat is closed.
- The browser can't change the card. Only the server can.

## Run it locally

You need Node.js and a free Cloudflare account.

```bash
git clone https://github.com/PaluruSuryaKiran/triage-agent.git
cd triage-agent
npm install
npx wrangler login
npm run dev
```

Then open http://localhost:5173. The model runs on Cloudflare even in local dev, so it uses your account's free Workers AI allowance.

To deploy: `npm run deploy`

## Try it

1. Paste the contents of `samples/incident1.txt`.
2. Follow up with: `Checked the DB: 2.8.1 reduced the pool size from 100 to 40.`
3. Then: `Rolled back 2.8.1 and the 503s stopped. Close the incident.` and approve the close.

## Tests

```bash
npm test
```

The tools take the store as a parameter, so the tests use a simple in-memory store instead of a real Durable Object. They check ID assignment, rejecting unknown IDs and fields, enum normalisation, replacing next actions and blocking updates after an incident is closed.

## Known issues

- **Replies don't stream word by word.** With Llama 3.3, `workers-ai-provider` reads every streamed chunk twice, which doubled the text and broke the JSON in tool calls. I found the cause in [cloudflare/ai#663](https://github.com/cloudflare/ai/pull/663), which isn't merged yet. As a workaround, I wrapped the model with the AI SDK's `simulateStreamingMiddleware`, which makes one normal call and replays it as a stream. It should be removed once the fix is released.
- **Arrays sometimes arrive as strings.** Llama 3.3 occasionally sends `hypotheses` or `nextActions` as a JSON string instead of an array, so that update fails validation.
- **The card can miss hypotheses.** The model sometimes records only its leading hypothesis, even when the reply discusses more.
- **No auth or rate limiting** on the demo URL.

## What I'd do next

- A shared list of all incidents, kept in a separate registry Durable Object, with search over past incidents
- A side panel in the UI that shows the incident card live
- Parse stringified arrays in the tool schema, and turn streaming back on once the upstream fix ships
- Cloudflare Access and rate limiting in front of the Worker
- Integration tests running inside the Workers runtime

## How I used AI

My background is C#/.NET, Python and Azure. Cloudflare Workers, Durable Objects and TypeScript on the backend were new to me, and I built this over a weekend. I leaned on AI for TypeScript and SDK specifics, and focused my own effort on the design, the triage prompt, debugging and reviewing the generated code.

I used GitHub Copilot for most of the code changes and debugging and reviewing of Copilot's output. My Copilot prompts are in [PROMPTS.md](PROMPTS.md), and utilized Claude for generating this readme file and is reviewed and modified; Claude conversation is here: [LINK](https://claude.ai/share/51407841-c4f3-4259-ac95-376326baf70a).
