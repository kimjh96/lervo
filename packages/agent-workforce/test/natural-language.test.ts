import { describe, expect, it } from "vitest";

import type { GroundingDecision, SemanticGroundingProposal } from "@lervo/request-grounding";

import { planGroundedWorkforceRequest } from "../src/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const resultDigest = `sha256:${"b".repeat(64)}`;

function grounded(input: {
  workflowId: string;
  subjectIds: string[];
  coordinates?: SemanticGroundingProposal["protocolCoordinates"];
}): { proposal: SemanticGroundingProposal; decision: GroundingDecision } {
  const proposal: SemanticGroundingProposal = {
    schemaVersion: 1,
    requestDigest: digest,
    resolver: { kind: "provider_adapter", providerId: "codex", resultDigest },
    intent: input.workflowId === "workforce.inspect" ? "inspect" : "coordinate_agents",
    subjectIds: input.subjectIds,
    references: [],
    protocolCoordinates: input.coordinates ?? [],
    requestedEffectIds: [input.workflowId],
    prohibitedEffectIds: [],
    sourceClasses: ["repository_state"],
    retrievalQueries: [],
    workflowCandidateIds: [input.workflowId],
    capabilityCandidateIds: [],
    authorityRequirement: input.workflowId === "workforce.inspect" ? "read" : "repository_write",
    providerRoute: { mode: "current_provider_only", providerIds: [] },
    disposition: input.workflowId === "workforce.inspect" ? "answer" : "execute",
    ambiguityReasons: [],
    durableInstruction: {
      disposition: "none",
      speechAct: "other",
      authority: "inferred",
      durability: "unspecified",
      operation: "none",
      scope: { kind: "unspecified", paths: [] },
      title: null,
      statement: null,
      exceptions: [],
      risk: "unknown",
      conflict: "unknown",
      confidence: "low",
      reasonIds: [],
    },
  };
  return {
    proposal,
    decision: {
      schemaVersion: 1,
      status: "ready",
      workflowId: input.workflowId,
      effectIds: [input.workflowId],
      capabilityIds: [],
      providerIds: ["codex"],
      authority: proposal.authorityRequirement,
      sourceClasses: proposal.sourceClasses,
      subjectIds: proposal.subjectIds,
      retrievalQueries: [],
      reasons: [],
    },
  };
}

describe("grounded workforce planning", () => {
  it("maps a provider-grounded role without retaining request text", () => {
    const resolution = grounded({ workflowId: "workforce.hire", subjectIds: ["role.researcher"] });
    const plan = planGroundedWorkforceRequest({
      ...resolution,
      agents: [],
      assignments: [],
      roles: [{ roleId: "researcher", name: "Researcher", sourceKind: "built_in" }],
    });
    expect(plan).toMatchObject({ intent: "hire", status: "ready", roleId: "researcher" });
    expect(JSON.stringify(plan)).not.toContain("채용해 주세요");
  });

  it("accepts only an exact role subject from the supplied repository catalog", () => {
    const resolution = grounded({
      workflowId: "workforce.hire",
      subjectIds: ["role.legal-researcher"],
    });
    const plan = planGroundedWorkforceRequest({
      ...resolution,
      agents: [],
      assignments: [],
      roles: [{ roleId: "legal-researcher", name: "법률 연구자", sourceKind: "repository" }],
    });
    expect(plan).toMatchObject({ intent: "hire", status: "ready", roleId: "legal-researcher" });
  });

  it("requires a safe repository coordinate for assignment scope", () => {
    const resolution = grounded({ workflowId: "workforce.assign", subjectIds: ["role.developer"] });
    const plan = planGroundedWorkforceRequest({
      ...resolution,
      agents: [],
      assignments: [],
      roles: [{ roleId: "developer", name: "Developer", sourceKind: "built_in" }],
    });
    expect(plan).toMatchObject({
      intent: "assign",
      status: "pending_decision",
      roleId: "developer",
    });
    expect(plan.pending).toContainEqual(expect.objectContaining({ field: "scope" }));
  });
});
