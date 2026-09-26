import { createWorkersAI } from "workers-ai-provider";
import { simulateStreamingMiddleware, wrapLanguageModel } from "ai";

/** Build the shared Workers AI model used for incident-triage responses. */
export function createTriageModel(binding: Ai, sessionAffinity: string) {
  const workersai = createWorkersAI({ binding });

  return wrapLanguageModel({
    model: workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      sessionAffinity
    }),
    middleware: simulateStreamingMiddleware()
  });
}
