import { expect, it } from "vitest";
import type { EventEnvelope } from "@lervo/schemas";
import { managedExecutionIdentity } from "@lervo/work-controller";
import { assertOwnerProposalFeedback } from "../src/supervision-reasoning-feedback.js";
import {
  InvalidNativeOwnerProposalError,
  nativeTaskRequirement,
} from "../src/supervision-native-task.js";
import type { NativeOwnerPlanInput } from "../src/supervision-native-plans.js";

const input = {
  facts: { mandate: { maximumDeadlineMs: 3_600_000, roleIds: [] }, roles: [] },
  base: { ownerAgentId: `agt_${"a".repeat(24)}` },
  now: () => "2026-09-25T00:00:00.000Z",
} as unknown as NativeOwnerPlanInput;

function rejection(details: Record<string, unknown>) {
  try {
    nativeTaskRequirement(input, details);
  } catch (error) {
    if (error instanceof InvalidNativeOwnerProposalError) return error;
    throw error;
  }
  throw new Error("The proposal was accepted.");
}

it("names the missing and unexpected allocation keys of a rejected proposal", () => {
  // Kael's owner twice sent only roleId, taskPurpose and deliverables.
  const error = rejection({
    roleId: "developer",
    taskPurpose: "Record the replay.",
    deliverables: ["An updated document"],
    notes: "not a task field",
  });
  expect(error.reasonCode).toBe("invalid_task_contract");
  expect(error.invalidFields).toEqual([
    "acceptanceCriteria",
    "decisionLatitude",
    "expectedPaths",
    "requiredCapabilities",
    "verificationSuiteIds",
    "completionSeconds",
    "unexpected_field",
  ]);
});

it("names an overlong task purpose that the responsibility contract would reject", () => {
  // Kael's owner then sent 2,069 and 2,362 character purposes without any named field.
  const error = rejection({
    roleId: "developer",
    taskPurpose: "x".repeat(2049),
    deliverables: ["An updated document"],
    acceptanceCriteria: ["The document states the verified span"],
    decisionLatitude: ["Wording"],
    expectedPaths: ["docs/a.md"],
    requiredCapabilities: ["filesystem.read"],
    verificationSuiteIds: ["role.development.artifact"],
    completionSeconds: 1800,
  });
  expect(error.invalidFields).toEqual(["taskPurpose"]);
});

it("accepts feedback that names only exact allocation keys", () => {
  const projectId = `prj_${"b".repeat(16)}`;
  const reasoningPlanHash = `sha256:${"c".repeat(64)}`;
  const resultArtifactHash = `sha256:${"d".repeat(64)}`;
  const events = [
    {
      type: "work.supervision.decision.recorded",
      payload: { planHash: reasoningPlanHash, supervisionId: "s.one", workstreamId: "wks_one" },
    },
    {
      type: "run.completed",
      runId: managedExecutionIdentity(projectId, reasoningPlanHash).runId,
      payload: { resultDigest: resultArtifactHash },
    },
  ] as unknown as EventEnvelope[];
  const check = (invalidFields: unknown) =>
    assertOwnerProposalFeedback({
      feedback: {
        reasonCode: "invalid_task_contract",
        reasoningPlanHash,
        resultArtifactHash,
        invalidFields,
      },
      events,
      projectId,
      supervisionId: "s.one",
      workstreamId: "wks_one",
    });
  expect(() => check(["acceptanceCriteria", "unexpected_field"])).not.toThrow();
  expect(() => check(["free text from the model"])).toThrow(/invalid/u);
  expect(() => check([])).toThrow(/invalid/u);
});
