import { describe, expect, it } from "vitest";

import { planNaturalLanguageWorkforceRequest } from "../src/index.js";

describe("natural-language workforce planning", () => {
  it("resolves explicit Korean hiring without persisting request text", () => {
    const plan = planNaturalLanguageWorkforceRequest({
      request: "연구자를 채용해 주세요",
      agents: [],
      assignments: [],
    });
    expect(plan).toMatchObject({
      intent: "hire",
      status: "ready",
      roleId: "researcher",
      privacy: { rawRequestPersisted: false },
    });
    expect(JSON.stringify(plan)).not.toContain("채용해 주세요");
  });

  it("prefers an exact repository role name over a built-in term", () => {
    const plan = planNaturalLanguageWorkforceRequest({
      request: "법률 연구자를 고용해 주세요",
      agents: [],
      assignments: [],
      roles: [{ roleId: "legal-researcher", name: "법률 연구자", sourceKind: "repository" }],
    });
    expect(plan).toMatchObject({ intent: "hire", status: "ready", roleId: "legal-researcher" });
  });

  it("turns ambiguous assignment scope into one bounded decision", () => {
    const plan = planNaturalLanguageWorkforceRequest({
      request: "Assign the developer this work",
      agents: [],
      assignments: [],
    });
    expect(plan).toMatchObject({
      intent: "assign",
      status: "pending_decision",
      roleId: "developer",
    });
    expect(plan.pending).toContainEqual(expect.objectContaining({ field: "scope" }));
  });
});
