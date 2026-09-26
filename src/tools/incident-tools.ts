import { tool } from "ai";
import { z } from "zod";
import type {
  IncidentCard,
  IncidentHypothesis,
  HypothesisConfidence,
  HypothesisStatus
} from "../models/incident";

export interface IncidentTicketStore {
  load(): IncidentCard | null;
  save(incident: IncidentCard): void;
}

const hypothesisPatchSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    cause: z.string().trim().min(1).max(200).optional(),
    confidence: z.preprocess(
      normalizeEnum,
      z.enum(["high", "medium", "low"])
    ).optional(),
    status: z.preprocess(
      normalizeEnum,
      z.enum(["active", "ruled_out", "confirmed"])
    ).optional(),
    statusRationale: z.string().trim().min(1).max(300).optional(),
    evidence: z.array(z.string().trim().min(1).max(300)).max(5).optional(),
    suggestedFix: z.string().trim().min(1).max(300).optional()
  })
  .strict();

function normalizeEnum(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase().replace(/[ -]+/g, "_");
}

const incidentPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    status: z.preprocess(
      normalizeEnum,
      z.enum(["open", "in_progress"])
    ).optional(),
    severity: z.preprocess(
      normalizeEnum,
      z.enum(["critical", "high", "medium", "low"])
    ).optional(),
    summary: z.string().trim().min(1).max(500).optional(),
    hypotheses: z.array(hypothesisPatchSchema).max(5).optional(),
    nextActions: z.array(z.string().trim().min(1).max(200)).max(5).optional()
  })
  .strict();

type IncidentPatch = z.infer<typeof incidentPatchSchema>;
type HypothesisPatch = z.infer<typeof hypothesisPatchSchema>;

export type IncidentUpdateFailure = {
  success: false;
  message: string;
  validationErrors: string[];
  correctionInstructions: string;
};

function fail(...validationErrors: string[]): IncidentUpdateFailure {
  return {
    success: false,
    message: "Incident update was not saved.",
    validationErrors,
    correctionInstructions:
      "Use only the documented case-sensitive field names and enum values. Correct the listed validation errors, then call updateIncident again with only the changed fields. Do not claim the ticket was updated until the tool returns success."
  };
}

function normalizeCause(cause: string): string {
  return cause.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mergeUniqueStrings(previous: string[], incoming: string[]): string[] {
  const values = new Map<string, string>();
  for (const value of [...previous, ...incoming]) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !values.has(key)) values.set(key, trimmed);
  }
  return [...values.values()];
}

function nextHypothesisId(hypotheses: IncidentHypothesis[]): string {
  const highest = hypotheses.reduce((max, hypothesis) => {
    const match = /^h-(\d+)$/.exec(hypothesis.id ?? "");
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `h-${String(highest + 1).padStart(3, "0")}`;
}

function toConfidence(value: HypothesisConfidence | undefined): HypothesisConfidence {
  return value ?? "low";
}

function toStatus(value: HypothesisStatus | undefined): HypothesisStatus {
  return value ?? "active";
}

function mergeHypothesisPatch(
  previous: IncidentHypothesis[],
  incoming: HypothesisPatch[]
): { hypotheses: IncidentHypothesis[]; changedHypotheses: IncidentHypothesis[]; errors: string[] } {
  const hypotheses = previous.map((hypothesis) => ({
    ...hypothesis,
    evidence: [...hypothesis.evidence]
  }));
  const changedHypotheses: IncidentHypothesis[] = [];
  const errors: string[] = [];

  for (const [index, patch] of incoming.entries()) {
    if (!patch.id && !patch.cause) {
      errors.push(`hypotheses[${index}] needs an id (existing hypothesis) or cause (new hypothesis).`);
      continue;
    }

    const matchingById = patch.id
      ? hypotheses.findIndex((hypothesis) => hypothesis.id === patch.id)
      : -1;
    if (patch.id && matchingById < 0) {
      errors.push(`hypotheses[${index}].id "${patch.id}" does not exist; omit id and provide cause to create a new hypothesis.`);
      continue;
    }

    const matchingByCause = patch.cause
      ? hypotheses.findIndex(
          (hypothesis) =>
            normalizeCause(hypothesis.cause ?? "") === normalizeCause(patch.cause ?? "")
        )
      : -1;
    const existingIndex = matchingById >= 0 ? matchingById : matchingByCause;

    if (existingIndex < 0) {
      if (!patch.cause) {
        errors.push(`hypotheses[${index}] is new and requires cause.`);
        continue;
      }
      const newStatus = toStatus(patch.status);
      if (
        (newStatus === "ruled_out" || newStatus === "confirmed") &&
        !patch.statusRationale
      ) {
        errors.push(`hypotheses[${index}] has status ${newStatus}; provide statusRationale explaining the supporting evidence or check.`);
        continue;
      }
      if (
        newStatus === "confirmed" &&
        (!patch.evidence || patch.evidence.length === 0)
      ) {
        errors.push(`hypotheses[${index}] is confirmed but has no evidence; include evidence or use status active.`);
        continue;
      }
      const created: IncidentHypothesis = {
        id: nextHypothesisId(hypotheses),
        cause: patch.cause,
        confidence: toConfidence(patch.confidence),
        status: newStatus,
        statusRationale:
          patch.statusRationale ?? "New hypothesis; not yet tested.",
        evidence: mergeUniqueStrings([], patch.evidence ?? []),
        suggestedFix: patch.suggestedFix ?? ""
      };
      hypotheses.push(created);
      changedHypotheses.push(created);
      continue;
    }

    const existing = hypotheses[existingIndex];
    const previousEvidence = existing.evidence ?? [];
    const incomingEvidence = patch.evidence ?? [];
    const addedEvidence = incomingEvidence.filter(
      (item) =>
        !previousEvidence.some(
          (stored) => stored.toLowerCase() === item.toLowerCase()
        )
    );

    let status = patch.status ?? existing.status;
    let statusRationale = patch.statusRationale ?? existing.statusRationale;

    // A rule-out can only be reopened when the update includes new evidence.
    if (
      existing.status === "ruled_out" &&
      patch.status !== undefined &&
      patch.status !== "ruled_out" &&
      addedEvidence.length === 0
    ) {
      status = existing.status;
      statusRationale = existing.statusRationale;
      errors.push(`Hypothesis ${existing.id} is ruled_out. To reopen it, include new evidence in the same patch and explain why it changes the disposition in statusRationale.`);
    } else if (
      existing.status === "ruled_out" &&
      patch.status !== undefined &&
      patch.status !== "ruled_out" &&
      !patch.statusRationale
    ) {
      errors.push(`Hypothesis ${existing.id} is ruled_out. Reopening it requires a new statusRationale explaining how the new evidence changes the disposition.`);
    }

    if (status === "ruled_out" && !statusRationale) {
      errors.push(`Hypothesis ${existing.id} cannot be ruled_out without statusRationale describing the check/evidence.`);
      continue;
    }
    if (status === "confirmed" && !(patch.evidence?.length || existing.evidence?.length)) {
      errors.push(`Hypothesis ${existing.id} cannot be confirmed without evidence; include evidence or leave it active.`);
      continue;
    }
    if (status === "confirmed" && !statusRationale) {
      errors.push(`Hypothesis ${existing.id} cannot be confirmed without statusRationale tying the evidence to the cause.`);
      continue;
    }
    const merged: IncidentHypothesis = {
      ...existing,
      cause: patch.cause ?? existing.cause,
      confidence: patch.confidence ?? existing.confidence,
      status,
      statusRationale: statusRationale ?? "",
      evidence: mergeUniqueStrings(previousEvidence, incomingEvidence),
      suggestedFix: patch.suggestedFix ?? existing.suggestedFix ?? ""
    };
    hypotheses[existingIndex] = merged;
    changedHypotheses.push(merged);
  }

  return { hypotheses, changedHypotheses, errors };
}

/** Applies strict, partial LLM updates to the active incident ticket. */
export function createIncidentTools(store: IncidentTicketStore) {
  return {
    updateIncident: tool({
      description:
        "Partially update the active incident ticket. Send only fields that changed; omitted fields are preserved. Use the exact case-sensitive fields title, status, severity, summary, hypotheses, nextActions. Status can be open or in_progress (incident resolution requires separate human approval). Severity is critical, high, medium, or low. Each hypothesis patch must identify an existing hypothesis by id, or provide cause for a new one; the server assigns new IDs (h-001, h-002, ...). Existing hypotheses merge evidence and update only supplied fields. For a repeated hypothesis, report its existing ID and state, and explain what has been done to rule it out or its current suggested fix/status rationale. A ruled_out hypothesis cannot be reopened unless new evidence is included in that patch. nextActions replaces the stored list entirely, so provide the complete desired list whenever it changes. The server sets updated. On success, use the returned authoritative incident card.",
      inputSchema: incidentPatchSchema,
      execute: async (patch: IncidentPatch) => {
        const hasChange = Object.values(patch).some((value) => value !== undefined);
        if (!hasChange) {
          return fail("Provide at least one changed incident field.");
        }

        const previous = store.load() ?? {
          title: "Untitled incident",
          status: "open" as const,
          severity: null,
          summary: "",
          hypotheses: [],
          nextActions: [],
          updated: new Date().toISOString()
        } satisfies IncidentCard;
        const hypothesisResult = mergeHypothesisPatch(
          previous.hypotheses,
          patch.hypotheses ?? []
        );
        if (hypothesisResult.errors.length > 0) {
          return fail(...hypothesisResult.errors);
        }

        const now = new Date().toISOString();
        const incident: IncidentCard = {
          ...previous,
          ...patch,
          hypotheses:
            patch.hypotheses === undefined
              ? previous.hypotheses
              : hypothesisResult.hypotheses,
          nextActions:
            patch.nextActions === undefined
              ? previous.nextActions
              : patch.nextActions,
          updated: now
        };

        store.save(incident);
        return {
          success: true as const,
          incident,
          changedHypotheses: hypothesisResult.changedHypotheses
        };
      }
    })
  };
}
