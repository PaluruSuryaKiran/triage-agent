export type IncidentStatus = "open" | "in_progress" | "resolved";

export type IncidentSeverity = "critical" | "high" | "medium" | "low";

export type HypothesisConfidence = "high" | "medium" | "low";

export type HypothesisStatus = "active" | "ruled_out" | "confirmed";

export type IncidentHypothesis = {
  id: string;
  cause: string;
  confidence: HypothesisConfidence;
  status: HypothesisStatus;
  /** Evidence-based explanation of the current status, including rule-out work. */
  statusRationale: string;
  evidence: string[];
  suggestedFix: string;
};

/** Data shown on the incident card and persisted for the active incident. */
export type IncidentCard = {
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity | null;
  summary: string;
  hypotheses: IncidentHypothesis[];
  /** Proposed checks and other recommended steps are tracked here. */
  nextActions: string[];
  /** Human identity recorded when the incident is resolved. */
  closedBy: string | null;
  /** ISO 8601 timestamp when the incident was resolved. */
  closedAt: string | null;
  /** ISO 8601 timestamp of the most recent incident-card update. */
  updated: string;
};
