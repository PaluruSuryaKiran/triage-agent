import { describe, expect, it } from "vitest";
import type { IncidentCard } from "../models/incident";
import {
  createIncidentTools,
  incidentPatchSchema,
  type IncidentTicketStore
} from "./incident-tools";

class InMemoryIncidentStore implements IncidentTicketStore {
  incident: IncidentCard | null = null;

  load() {
    return this.incident;
  }

  save(incident: IncidentCard) {
    this.incident = incident;
  }
}

async function update(
  store: InMemoryIncidentStore,
  input: unknown
): Promise<Record<string, unknown>> {
  const updateTool = createIncidentTools(store).updateIncident;
  if (!updateTool.execute) throw new Error("updateIncident has no executor");
  const parsedInput = incidentPatchSchema.parse(input);
  return (await updateTool.execute(parsedInput as never, {} as never)) as Record<
    string,
    unknown
  >;
}

function hypothesis(cause: string) {
  return {
    cause,
    confidence: "medium",
    status: "active",
    evidence: [`Evidence for ${cause}`]
  };
}

describe("createIncidentTools", () => {
  it("assigns sequential IDs to new hypotheses", async () => {
    const store = new InMemoryIncidentStore();

    const result = await update(store, {
      hypotheses: [hypothesis("Database pool exhaustion"), hypothesis("Upstream timeout")]
    });

    expect(result.success).toBe(true);
    expect(store.incident?.hypotheses.map(({ id }) => id)).toEqual([
      "h-001",
      "h-002"
    ]);
  });

  it("rejects unknown hypothesis IDs without changing the ticket", async () => {
    const store = new InMemoryIncidentStore();
    await update(store, { hypotheses: [hypothesis("Database pool exhaustion")] });
    const before = structuredClone(store.incident);

    const result = await update(store, {
      hypotheses: [{ id: "h-999", statusRationale: "New evidence" }]
    });

    expect(result.success).toBe(false);
    expect(store.incident).toEqual(before);
  });

  it("rejects unknown incident and hypothesis fields with strict schemas", () => {
    expect(incidentPatchSchema.safeParse({ unexpected: "value" }).success).toBe(
      false
    );
    expect(
      incidentPatchSchema.safeParse({
        hypotheses: [{ cause: "Database issue", unexpected: "value" }]
      }).success
    ).toBe(false);
  });

  it("normalizes enum values such as High", async () => {
    const store = new InMemoryIncidentStore();

    const result = await update(store, { severity: "High" });

    expect(result.success).toBe(true);
    expect(store.incident?.severity).toBe("high");
  });

  it("replaces nextActions instead of appending to them", async () => {
    const store = new InMemoryIncidentStore();
    await update(store, { nextActions: ["Check pool metrics", "Compare regions"] });

    const result = await update(store, { nextActions: ["Review deploy diff"] });

    expect(result.success).toBe(true);
    expect(store.incident?.nextActions).toEqual(["Review deploy diff"]);
  });

  it("rejects updates after the incident is resolved", async () => {
    const store = new InMemoryIncidentStore();
    await update(store, { summary: "Initial incident summary" });
    store.incident = {
      ...store.incident!,
      status: "resolved",
      closedBy: "incident-commander",
      closedAt: new Date().toISOString()
    };
    const before = structuredClone(store.incident);

    const result = await update(store, { summary: "Try to edit a closed ticket" });

    expect(result.success).toBe(false);
    expect(store.incident).toEqual(before);
  });
});
