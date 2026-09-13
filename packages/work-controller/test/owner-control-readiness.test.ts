import { describe, expect, it } from "vitest";
import type {
  OwnerControlReadinessV1,
  SupervisedGoalCompletionV1,
} from "@lervo/application-contract";
import {
  assertOwnerControlReadiness,
  operatingContractHash,
  operatingReadinessKind,
  supervisedGoalCompletionFields,
  assertSupervisedGoalCompletion,
} from "../src/index.js";
import { plan, now, hash, owner } from "./operating-supervision.fixture.js";

function fixture() {
  const effect: SupervisedGoalCompletionV1 = {
    schemaVersion: 1,
    kind: "work.goal_completion",
    workstreamId: plan().workstreamId,
    workstreamRevision: 1,
    workstreamSnapshotHash: hash("b"),
    ownerAgentId: owner,
    assignmentReviews: [
      {
        assignmentId: `asn_${"a".repeat(24)}`,
        assignmentRevision: 2,
        reviewEventId: `evt_${"b".repeat(32)}`,
      },
    ],
    resultArtifactHash: hash("c"),
    rationaleArtifactHash: hash("d"),
    completedAt: now,
  };
  const action = { ...plan(), ...supervisedGoalCompletionFields(effect) };
  const observation: OwnerControlReadinessV1 = {
    schemaVersion: 1,
    kind: "work.owner_control.readiness",
    planHash: operatingContractHash(action),
    sourceRevisionDigest: action.sourceRevisionDigest,
    ownerAgentId: owner,
    effectContract: "work.goal_completion.v1",
    observedAt: now,
    validUntil: "2026-09-11T03:00:05.000Z",
    status: "ready",
    reasonCodes: [],
  };
  return { effect, action, observation };
}

describe("exact owner control readiness", () => {
  it("admits exact control readiness without inventing a worker lease", () => {
    const { effect, action, observation } = fixture();
    expect(operatingReadinessKind(action)).toBe("owner_control");
    expect(() => assertSupervisedGoalCompletion(effect, action)).not.toThrow();
    expect(() => assertOwnerControlReadiness({ plan: action, observation, now })).not.toThrow();
    expect(operatingReadinessKind({ ...action, effectContract: "work.managed_execution.v1" })).toBe(
      "worker",
    );
    expect(operatingReadinessKind({ ...action, effectContract: "unmapped.control.v1" })).toBe(
      "worker",
    );
    expect(
      operatingReadinessKind({
        ...action,
        actionKind: "publish_result",
        effectContract: "work.result_delivery.v1",
      }),
    ).toBe("owner_control");
  });
  it.each([
    "plan",
    "source",
    "owner",
    "contract",
    "blocked",
    "reason",
    "expired",
    "future",
    "duration",
  ] as const)("rejects %s readiness", (defect) => {
    const { action, observation } = fixture();
    if (defect === "plan") observation.planHash = hash("f");
    if (defect === "source") observation.sourceRevisionDigest = hash("f");
    if (defect === "owner") observation.ownerAgentId = `agt_${"f".repeat(24)}`;
    if (defect === "contract") observation.effectContract = "work.artifact_review.v1";
    if (defect === "blocked") observation.status = "blocked";
    if (defect === "reason") observation.reasonCodes = ["unresolved_acceptance"];
    if (defect === "expired") observation.validUntil = now;
    if (defect === "future") observation.observedAt = "2026-09-11T03:00:01.000Z";
    if (defect === "duration") observation.validUntil = "2026-09-11T03:00:06.000Z";
    expect(() => assertOwnerControlReadiness({ plan: action, observation, now })).toThrow(
      "readiness",
    );
  });
  it("refuses completion with missing or duplicated reviews and widened effect scope", () => {
    const { action, effect } = fixture();
    expect(() => supervisedGoalCompletionFields({ ...effect, assignmentReviews: [] })).toThrow();
    expect(() =>
      supervisedGoalCompletionFields({
        ...effect,
        assignmentReviews: [...effect.assignmentReviews, ...effect.assignmentReviews],
      }),
    ).toThrow();
    expect(() =>
      assertSupervisedGoalCompletion(effect, {
        ...action,
        requiredCapabilities: ["filesystem.write"],
      }),
    ).toThrow("exact owner decision");
    expect(() =>
      assertSupervisedGoalCompletion({ ...effect, resultArtifactHash: hash("e") }, action),
    ).toThrow("exact owner decision");
  });
});
