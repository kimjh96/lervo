import { describe, expect, it } from "vitest";

import type { NoCapabilityProviderJsonRunner } from "@lervo/repository-knowledge-compiler";

import {
  createProcessGroundingResolver,
  GroundProductionRequestError,
  groundProductionRequest,
} from "../src/semantic-grounding.js";

const responseBody = {
  schemaVersion: 1,
  intent: "explain",
  subjectIds: ["terminal.integration"],
  references: [{ referenceId: "reported_failure", kind: "prior_turn", resolution: "resolved" }],
  protocolCoordinates: [],
  requestedEffectIds: ["terminal.answer"],
  prohibitedEffectIds: [],
  sourceClasses: ["repository_state"],
  retrievalQueries: ["terminal integration failure"],
  workflowCandidateIds: ["terminal.answer"],
  capabilityCandidateIds: [],
  authorityRequirement: "read",
  providerRoute: { mode: "current_provider_only", providerIds: [] },
  disposition: "answer",
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

const workflow = {
  workflowId: "terminal.answer",
  supportedIntents: ["explain" as const],
  supportedDispositions: ["answer" as const],
  effectIds: ["terminal.answer"],
  requiredSourceClasses: ["repository_state" as const],
  authority: "read" as const,
  allowedCapabilityIds: [],
  crossProviderAllowed: false,
};

describe("production semantic grounding adapter", () => {
  it("supplies the provider with the complete nested response schema", async () => {
    let observedInput: unknown;
    const runner: NoCapabilityProviderJsonRunner = {
      provider: "codex",
      resolve: async (input) => {
        observedInput = input;
        return responseBody;
      },
    };
    const resolver = await createProcessGroundingResolver(
      "codex",
      { workflows: [workflow], capabilityIds: [], grantedAuthorities: ["read"] },
      { createRunner: async () => runner },
    );
    await resolver.resolve({
      request: "What failed?",
      requestDigest: `sha256:${"a".repeat(64)}`,
      context: {
        priorTurns: [],
        currentWorkstream: null,
        pendingAuthorityIds: [],
        repositoryCondition: "current",
      },
    });

    expect(observedInput).toMatchObject({
      responseContract: {
        schema: {
          additionalProperties: false,
          properties: {
            references: {
              items: {
                additionalProperties: false,
                required: ["referenceId", "kind", "resolution"],
              },
            },
          },
        },
        rawRequestOrKeywordFieldsForbidden: true,
      },
    });
    expect((observedInput as { instruction: string }).instruction).toContain(
      "include every source class in that workflow's requiredSourceClasses",
    );
    expect((observedInput as { instruction: string }).instruction).toContain(
      "Never promote an inferred repository source path",
    );
    expect((observedInput as { instruction: string }).instruction).toContain(
      "semanticCatalog.retrievalLanguage",
    );
    expect((observedInput as { instruction: string }).instruction).toContain(
      "preserve its exact repository path or label",
    );
    expect((observedInput as { instruction: string }).instruction).toContain(
      "query-coverage fusion",
    );
    expect((observedInput as { instruction: string }).instruction).toContain(
      "explicitly named repository concepts and requested explanations as subjects",
    );
  });

  it("translates an invalid provider proposal into a stable adapter failure", async () => {
    await expect(
      groundProductionRequest({
        request: "뭐가 문제일까요",
        provider: "codex",
        resolutionContext: {
          priorTurns: [],
          currentWorkstream: null,
          pendingAuthorityIds: [],
          repositoryCondition: "current",
        },
        workflows: [workflow],
        grantedAuthorities: ["read"],
        resolver: {
          providerId: "codex",
          resolve: async ({ requestDigest }) => ({
            ...responseBody,
            requestDigest,
            resolver: {
              kind: "provider_adapter",
              providerId: "codex",
              resultDigest: `sha256:${"b".repeat(64)}`,
            },
            references: [
              {
                referenceId: "reported_failure",
                kind: "prior_turn",
                resolution: "resolved",
                unsupported: true,
              },
            ],
          }),
        },
      }),
    ).rejects.toMatchObject({
      name: "GroundProductionRequestError",
      code: "semantic_resolution_failed",
      message: "The current provider did not return a valid semantic grounding proposal.",
    });
  });

  it("names the failing stage without exposing provider output", () => {
    const stage = (cause: unknown) => new GroundProductionRequestError(cause).reasonIds;
    expect(stage(Object.assign(new Error("x"), { processStatus: "timed_out" }))).toEqual([
      "semantic_resolution_failed",
      "semantic_resolution_provider_timed_out",
    ]);
    expect(stage(Object.assign(new Error("x"), { processStatus: "spawn_failed" }))[1]).toBe(
      "semantic_resolution_provider_process_failed",
    );
    expect(stage(Object.assign(new Error("x"), { code: "knowledge_provider_paused" }))[1]).toBe(
      "semantic_resolution_provider_unavailable",
    );
    expect(stage(Object.assign(new Error("x"), { providerReportedFailure: true }))[1]).toBe(
      "semantic_resolution_provider_unavailable",
    );
    expect(stage(new TypeError("invalid nested reference"))[1]).toBe(
      "semantic_resolution_proposal_invalid",
    );
    expect(stage(new Error("other"))[1]).toBe("semantic_resolution_resolver_failed");
    expect(
      new GroundProductionRequestError(new Error("secret provider output")).message,
    ).not.toContain("secret");
  });
});
