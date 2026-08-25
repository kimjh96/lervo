import { afterEach, describe, expect, it } from "vitest";

import {
  CANDIDATE_ADAPTER_BUILD_ID,
  cleanupSearchComparisonRepositories,
  command,
} from "./search-evaluation-comparison-fixture.js";
import { prepareSelectedSearchCandidate } from "./search-selected-candidate-fixture.js";

afterEach(cleanupSearchComparisonRepositories);

describe("selection-bound search quality report", () => {
  it("separates implicit baseline, verified candidate build, and rollback baseline", async () => {
    const { root, activation, policy } = await prepareSelectedSearchCandidate("researcher.quality");

    const reported = await command(root, ["search", "report", "--json"]);
    expect(reported.code, reported.error).toBe(0);
    expect(JSON.parse(reported.output)).toMatchObject({
      schemaVersion: 2,
      totalAttempts: 2,
      assessedAttempts: 2,
      rolloutDecision: "not_determined",
      rollbackDecision: "not_determined",
      selections: [
        {
          selectionTransitionId: null,
          selectionState: "implicit_baseline",
          adapterBuildId: null,
          totalAttempts: 1,
          assessedAttempts: 1,
          acceptedAttempts: 1,
          evidenceState: "no_failures_observed",
        },
        {
          selectionTransitionId: activation.activationId,
          selectionState: "candidate",
          adapterBuildId: CANDIDATE_ADAPTER_BUILD_ID,
          totalAttempts: 1,
          assessedAttempts: 1,
          acceptedAttempts: 1,
          evidenceState: "no_failures_observed",
        },
      ],
    });
    expect(reported.output).not.toContain("zephyrcontext");
    expect(reported.output).not.toContain("docs/search-context.md");

    const rolledBack = await command(root, [
      "search",
      "engine",
      "rollback",
      "--policy",
      policy.policyId,
      "--operator",
      "operator_search",
      "--json",
    ]);
    expect(rolledBack.code, rolledBack.error).toBe(0);
    const rollbackId = (JSON.parse(rolledBack.output) as { activationId: string }).activationId;
    expect((await command(root, ["search", "evaluation query", "--json"])).code).toBe(0);
    const afterRollback = await command(root, ["search", "report", "--json"]);
    expect(afterRollback.code, afterRollback.error).toBe(0);
    expect((JSON.parse(afterRollback.output) as { selections: unknown[] }).selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selectionTransitionId: rollbackId,
          selectionState: "recorded_baseline",
          adapterBuildId: null,
          totalAttempts: 1,
          assessedAttempts: 0,
          evidenceState: "insufficient_assessment",
        }),
      ]),
    );
  });
});
