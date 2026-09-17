import { koreanConversationWritingContract } from "@lervo/core";
import { describe, expect, it } from "vitest";

import {
  assertDeliberationCallBudgetFeasible,
  minimumDeliberationProviderCalls,
} from "../src/deliberation-budget-feasibility.js";

describe("deliberation budget feasibility", () => {
  it("counts producer and semantic-evaluator calls for every configured turn", () => {
    expect(
      minimumDeliberationProviderCalls({
        maxRounds: 2,
        reviewerCount: 3,
        verificationSuiteCount: 1,
        writingContract: koreanConversationWritingContract,
      }),
    ).toBe(20);
  });

  it("rejects a policy that cannot complete its configured rounds without repair", () => {
    expect(() =>
      assertDeliberationCallBudgetFeasible({
        policy: {
          schemaVersion: 1,
          policyId: "deliberation_architecture-review",
          projectId: "prj_budget_test1",
          participants: [],
          decisionOwnerRoleId: "product-owner",
          maxRounds: 2,
          executionBudget: {
            maximumProviderCalls: 12,
            maximumObservedTokens: 500_000,
            maximumElapsedMs: 1_800_000,
            unobservedTokenDisposition: "block",
          },
          requiredVerificationSuiteIds: ["repository.default.v4"],
          convergence: {
            requireIndependentReviewer: true,
            requireIndependentSessions: true,
            requireDecisionOwnerDecision: true,
            requirePassedVerifications: true,
            requireZeroUnresolvedBlockingObjections: true,
            unresolvedBlockingDisposition: "no_consensus",
          },
          publication: {
            surface: "chat",
            writingPolicyId: "writing_ko-conversation",
            writingPolicyHash: `sha256:${"a".repeat(64)}`,
            requiresWritingPermit: true,
          },
        },
        reviewerCount: 3,
        writingContract: koreanConversationWritingContract,
      }),
    ).toThrow("require at least 20 calls");
  });
});
