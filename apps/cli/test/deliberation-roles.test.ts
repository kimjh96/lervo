import { koreanConversationWritingContract } from "@lervo/core";
import type { DeliberationWorkflowSource } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { createStoredDeliberationExecutionPlan } from "../src/deliberation-roles.js";

describe("stored deliberation roles", () => {
  it("uses the policy-owned Korean participant labels on a Korean surface", () => {
    const source: DeliberationWorkflowSource = {
      schemaVersion: 1,
      policyId: "deliberation_localized-review",
      maxRounds: 1,
      executionBudget: {
        maximumProviderCalls: 12,
        maximumObservedTokens: 200_000,
        maximumElapsedMs: 300_000,
        unobservedTokenDisposition: "block",
      },
      requiredVerificationSuiteIds: ["repository.default.v4"],
      participants: [
        {
          roleId: "product-owner",
          name: "Product owner",
          localizedNames: { ko: "제품 책임자" },
          description: "Owns the decision.",
          provider: "codex",
          responsibilities: ["proposer", "decision_owner"],
        },
        {
          roleId: "user-reviewer",
          name: "User reviewer",
          localizedNames: { ko: "사용자 검토자" },
          description: "Reviews the user experience.",
          provider: "claude",
          responsibilities: ["reviewer"],
        },
        {
          roleId: "repository-verifier",
          name: "Repository verifier",
          localizedNames: { ko: "저장소 검증자" },
          description: "Verifies repository evidence.",
          provider: "codex",
          responsibilities: ["verifier"],
        },
      ],
    };

    const plan = createStoredDeliberationExecutionPlan({
      projectId: "prj_localized01",
      source,
      writingContract: koreanConversationWritingContract,
    });

    expect(plan.participants.map((participant) => participant.role.name)).toEqual([
      "제품 책임자",
      "사용자 검토자",
      "저장소 검증자",
    ]);
  });
});
