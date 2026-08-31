import { describe, expect, it } from "vitest";

import {
  decideGroundedRequest,
  parseSemanticGroundingProposal,
  resolveGroundedRequest,
  semanticResolutionFailureDecision,
  validateProtocolCoordinate,
  extractProtocolCoordinates,
  type GroundingDecisionContext,
} from "../src/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const resultDigest = `sha256:${"b".repeat(64)}`;

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestDigest: digest,
    resolver: { kind: "provider_adapter", providerId: "codex", resultDigest },
    intent: "change",
    subjectIds: ["repository.instructions"],
    references: [
      { referenceId: "current_rule", kind: "repository_source", resolution: "resolved" },
    ],
    protocolCoordinates: [],
    requestedEffectIds: ["repository.instruction.update"],
    prohibitedEffectIds: [],
    sourceClasses: ["repository_instructions", "repository_state"],
    retrievalQueries: ["repository instructions"],
    workflowCandidateIds: ["repository.instruction.update"],
    capabilityCandidateIds: [],
    authorityRequirement: "repository_write",
    providerRoute: { mode: "current_provider_only", providerIds: [] },
    disposition: "execute",
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
    ...overrides,
  };
}

const context: GroundingDecisionContext = {
  currentProviderId: "codex",
  availableProviderIds: ["codex", "claude"],
  availableCapabilityIds: [],
  grantedAuthorities: ["read", "repository_write"],
  workflows: [
    {
      workflowId: "repository.instruction.update",
      supportedIntents: ["change"],
      supportedDispositions: ["execute"],
      effectIds: ["repository.instruction.update"],
      requiredSourceClasses: ["repository_instructions", "repository_state"],
      authority: "repository_write",
      allowedCapabilityIds: [],
      crossProviderAllowed: false,
    },
  ],
};

describe("typed semantic grounding", () => {
  it("fails closed without selecting any effect when semantic resolution fails", () => {
    expect(semanticResolutionFailureDecision()).toEqual({
      schemaVersion: 1,
      status: "abstain",
      workflowId: null,
      effectIds: [],
      capabilityIds: [],
      providerIds: [],
      authority: null,
      sourceClasses: [],
      subjectIds: [],
      retrievalQueries: [],
      reasons: ["semantic_resolution_failed"],
    });
  });

  it("makes the same decision for semantically grounded requests regardless of request digest", () => {
    const first = decideGroundedRequest({
      proposal: parseSemanticGroundingProposal(proposal()),
      context,
    });
    const second = decideGroundedRequest({
      proposal: parseSemanticGroundingProposal(
        proposal({ requestDigest: `sha256:${"c".repeat(64)}` }),
      ),
      context,
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "ready",
      workflowId: "repository.instruction.update",
      providerIds: ["codex"],
    });
  });

  it("rejects raw prompt and keyword fields instead of routing from them", () => {
    expect(() =>
      parseSemanticGroundingProposal({
        ...proposal(),
        prompt: "이 규칙을 다음에도 지켜줘",
      }),
    ).toThrow("unsupported or missing fields");
    expect(() =>
      parseSemanticGroundingProposal({
        ...proposal(),
        keywords: ["지식화", "remember"],
      }),
    ).toThrow("unsupported or missing fields");
  });

  it("clarifies unresolved references without selecting effects or providers", () => {
    const decision = decideGroundedRequest({
      proposal: parseSemanticGroundingProposal(
        proposal({
          references: [{ referenceId: "prior_item", kind: "prior_turn", resolution: "unresolved" }],
        }),
      ),
      context,
    });
    expect(decision).toEqual({
      schemaVersion: 1,
      status: "clarify",
      workflowId: null,
      effectIds: [],
      capabilityIds: [],
      providerIds: [],
      authority: null,
      sourceClasses: ["repository_instructions", "repository_state"],
      subjectIds: ["repository.instructions"],
      retrievalQueries: ["repository instructions"],
      reasons: ["reference_unresolved"],
    });
  });

  it("clarifies an unknown semantic intent without consulting workflow names", () => {
    const decision = decideGroundedRequest({
      proposal: parseSemanticGroundingProposal(proposal({ intent: "unknown" })),
      context,
    });
    expect(decision).toMatchObject({ status: "clarify", reasons: ["intent_unknown"] });
  });

  it("requires granted authority after workflow selection", () => {
    const decision = decideGroundedRequest({
      proposal: parseSemanticGroundingProposal(proposal()),
      context: { ...context, grantedAuthorities: ["read"] },
    });
    expect(decision).toMatchObject({
      status: "approval_required",
      workflowId: null,
      providerIds: [],
      reasons: ["authority_not_granted"],
    });
  });

  it("does not allow a semantic proposal to expand workflow effects or capabilities", () => {
    const effectDecision = decideGroundedRequest({
      proposal: parseSemanticGroundingProposal(
        proposal({ requestedEffectIds: ["repository.knowledge.publish"] }),
      ),
      context,
    });
    expect(effectDecision).toMatchObject({ status: "abstain", reasons: ["effect_not_allowed"] });

    const capabilityDecision = decideGroundedRequest({
      proposal: parseSemanticGroundingProposal(
        proposal({ capabilityCandidateIds: ["external.semantic.service"] }),
      ),
      context,
    });
    expect(capabilityDecision).toMatchObject({
      status: "abstain",
      reasons: ["capability_not_allowed"],
    });
  });

  it("requires the workflow disposition and source contract", () => {
    expect(
      decideGroundedRequest({
        proposal: parseSemanticGroundingProposal(proposal({ disposition: "answer" })),
        context,
      }),
    ).toMatchObject({ status: "abstain", reasons: ["disposition_not_supported"] });
    expect(
      decideGroundedRequest({
        proposal: parseSemanticGroundingProposal({
          ...proposal(),
          sourceClasses: ["repository_state"],
        }),
        context,
      }),
    ).toMatchObject({ status: "abstain", reasons: ["source_class_missing"] });
  });

  it("requires an explicitly allowed and available cross-provider route", () => {
    const crossProvider = parseSemanticGroundingProposal(
      proposal({
        providerRoute: {
          mode: "cross_provider_deliberation",
          providerIds: ["codex", "claude"],
        },
      }),
    );
    expect(decideGroundedRequest({ proposal: crossProvider, context })).toMatchObject({
      status: "abstain",
      reasons: ["provider_route_not_allowed"],
    });
  });

  it("validates only explicitly supplied protocol coordinates", () => {
    expect(
      validateProtocolCoordinate({
        kind: "assignment_id",
        value: "asn_561d4d7c72da47b7f08a2deb",
      }),
    ).toEqual({ kind: "assignment_id", value: "asn_561d4d7c72da47b7f08a2deb" });
    expect(() =>
      validateProtocolCoordinate({ kind: "repository_path", value: "../outside.md" }),
    ).toThrow("Invalid repository_path");
  });

  it("extracts exact protocol coordinates without interpreting natural-language path labels", () => {
    expect(
      extractProtocolCoordinates(
        "assign asn_561d4d7c72da47b7f08a2deb to repo-path:docs/roadmap/v0.md 경로:AGENTS.md",
      ),
    ).toEqual([
      { kind: "assignment_id", value: "asn_561d4d7c72da47b7f08a2deb" },
      { kind: "repository_path", value: "docs/roadmap/v0.md" },
    ]);
  });

  it("rejects contradictory requested and prohibited effects", () => {
    expect(() =>
      parseSemanticGroundingProposal(
        proposal({ prohibitedEffectIds: ["repository.instruction.update"] }),
      ),
    ).toThrow("both requested and prohibited");
  });

  it("passes raw language only through the current provider adapter", async () => {
    const request = "이 규칙을 다음 작업에서도 지켜줘";
    let observedRequest = "";
    const resolved = await resolveGroundedRequest({
      request,
      resolutionContext: {
        priorTurns: [],
        currentWorkstream: null,
        pendingAuthorityIds: [],
        repositoryCondition: "current",
      },
      decisionContext: context,
      resolver: {
        providerId: "codex",
        resolve: async ({ request: received, requestDigest }) => {
          observedRequest = received;
          return proposal({ requestDigest });
        },
      },
    });
    expect(observedRequest).toBe(request);
    expect(resolved.decision.status).toBe("ready");
    expect(JSON.stringify(resolved)).not.toContain(request);
  });

  it("passes a bounded current-workstream context to the resolver", async () => {
    const workstreamContext = "Current objective: qualify lexical-v2 without weakening gates.";
    let observedContext: unknown;
    await resolveGroundedRequest({
      request: "그 기준을 유지해줘",
      resolutionContext: {
        priorTurns: [],
        currentWorkstream: {
          workstreamId: `wks_${"1".repeat(24)}`,
          revision: 7,
          context: workstreamContext,
        },
        pendingAuthorityIds: [],
        repositoryCondition: "current",
      },
      decisionContext: context,
      resolver: {
        providerId: "codex",
        resolve: async ({ requestDigest, context: received }) => {
          observedContext = received.currentWorkstream;
          return proposal({ requestDigest });
        },
      },
    });
    expect(observedContext).toEqual({
      workstreamId: `wks_${"1".repeat(24)}`,
      revision: 7,
      context: workstreamContext,
    });
  });

  it("rejects an unbounded current-workstream context before provider execution", async () => {
    let called = false;
    await expect(
      resolveGroundedRequest({
        request: "Continue.",
        resolutionContext: {
          priorTurns: [],
          currentWorkstream: {
            workstreamId: `wks_${"1".repeat(24)}`,
            revision: 7,
            context: "x".repeat(8_193),
          },
          pendingAuthorityIds: [],
          repositoryCondition: "current",
        },
        decisionContext: context,
        resolver: {
          providerId: "codex",
          resolve: async ({ requestDigest }) => {
            called = true;
            return proposal({ requestDigest });
          },
        },
      }),
    ).rejects.toThrow("current workstream coordinate is invalid");
    expect(called).toBe(false);
  });

  it("accepts an exact protocol coordinate copied from bounded current-workstream context", async () => {
    const path = "docs/decisions/search/engines/0318-qualification.md";
    const resolved = await resolveGroundedRequest({
      request: "Use the current qualification reference.",
      resolutionContext: {
        priorTurns: [],
        currentWorkstream: {
          workstreamId: `wks_${"1".repeat(24)}`,
          revision: 7,
          context: `Qualification reference: ${path}`,
        },
        pendingAuthorityIds: [],
        repositoryCondition: "current",
      },
      decisionContext: context,
      resolver: {
        providerId: "codex",
        resolve: async ({ requestDigest }) =>
          proposal({
            requestDigest,
            protocolCoordinates: [{ kind: "repository_path", value: path }],
          }),
      },
    });

    expect(resolved.proposal.protocolCoordinates).toEqual([
      { kind: "repository_path", value: path },
    ]);
  });

  it("rejects a protocol coordinate that is only a substring of a workstream coordinate", async () => {
    await expect(
      resolveGroundedRequest({
        request: "Use the current qualification reference.",
        resolutionContext: {
          priorTurns: [],
          currentWorkstream: {
            workstreamId: `wks_${"1".repeat(24)}`,
            revision: 7,
            context: "Qualification reference: docs/search/qualification-v20.md",
          },
          pendingAuthorityIds: [],
          repositoryCondition: "current",
        },
        decisionContext: context,
        resolver: {
          providerId: "codex",
          resolve: async ({ requestDigest }) =>
            proposal({
              requestDigest,
              protocolCoordinates: [
                { kind: "repository_path", value: "docs/search/qualification" },
              ],
            }),
        },
      }),
    ).rejects.toThrow("invented a protocol coordinate");
  });

  it("rejects proposals bound to another request or provider without fallback", async () => {
    const resolutionContext = {
      priorTurns: [],
      currentWorkstream: null,
      pendingAuthorityIds: [],
      repositoryCondition: "current" as const,
    };
    await expect(
      resolveGroundedRequest({
        request: "Preserve this behavior for later work.",
        resolutionContext,
        decisionContext: context,
        resolver: { providerId: "codex", resolve: async () => proposal() },
      }),
    ).rejects.toThrow("another request");
    await expect(
      resolveGroundedRequest({
        request: "Preserve this behavior for later work.",
        resolutionContext,
        decisionContext: context,
        resolver: {
          providerId: "claude",
          resolve: async () =>
            proposal({
              resolver: { kind: "provider_adapter", providerId: "claude", resultDigest },
            }),
        },
      }),
    ).rejects.toThrow("current provider adapter");
  });

  it("rejects a provider-invented coordinate even when its shape is valid", async () => {
    await expect(
      resolveGroundedRequest({
        request: "Assign the approved work.",
        resolutionContext: {
          priorTurns: [],
          currentWorkstream: null,
          pendingAuthorityIds: [],
          repositoryCondition: "current",
        },
        decisionContext: context,
        resolver: {
          providerId: "codex",
          resolve: async ({ requestDigest }) =>
            proposal({
              requestDigest,
              protocolCoordinates: [
                { kind: "assignment_id", value: "asn_561d4d7c72da47b7f08a2deb" },
              ],
            }),
        },
      }),
    ).rejects.toThrow("invented a protocol coordinate");
  });
});
