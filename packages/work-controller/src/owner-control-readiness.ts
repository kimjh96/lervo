import type { OperatingActionPlanV1, OwnerControlReadinessV1 } from "@lervo/application-contract";
import { operatingContractHash } from "./operating-mandate-admission.js";

export function operatingReadinessKind(
  plan: OperatingActionPlanV1,
): "owner_control" | "worker" | "none" {
  if (plan.actionKind === "escalate" && plan.effectContract === "work.owner_attention.v1")
    return "owner_control";
  if (
    (plan.effectContract === "work.scoped_handoff.v1" &&
      ["request_team_support", "escalate"].includes(plan.actionKind)) ||
    (plan.effectContract === "work.scoped_handoff_acceptance.v1" &&
      plan.actionKind === "execute_as_owner")
  )
    return "owner_control";
  if (
    ["work.assignment_recovery.v1", "work.assignment_recovery.v2"].includes(plan.effectContract) &&
    ["request_rework", "retry_attempt"].includes(plan.actionKind)
  )
    return "none";
  if (
    plan.actionKind === "publish_result" &&
    ["work.result_delivery.v1", "work.result_delivery.v2"].includes(plan.effectContract)
  )
    return "owner_control";
  if (
    plan.actionKind === "execute_as_owner" &&
    [
      "work.artifact_review.v1",
      "work.goal_completion.v1",
      "work.owner_reasoning.v1",
      "work.workspace_preparation.v1",
      "work.assignment_completion.v1",
      "work.assignment_completion.v2",
    ].includes(plan.effectContract)
  )
    return "owner_control";
  return ["dispatch", "retry_attempt", "execute_as_owner"].includes(plan.actionKind)
    ? "worker"
    : "none";
}

export function assertOwnerControlReadiness(input: {
  plan: OperatingActionPlanV1;
  observation: OwnerControlReadinessV1;
  now: string;
}): void {
  const { plan, observation, now } = input;
  const age = Date.parse(now) - Date.parse(observation.observedAt);
  const duration = Date.parse(observation.validUntil) - Date.parse(observation.observedAt);
  if (
    operatingReadinessKind(plan) !== "owner_control" ||
    observation.schemaVersion !== 1 ||
    observation.kind !== "work.owner_control.readiness" ||
    observation.planHash !== operatingContractHash(plan) ||
    observation.sourceRevisionDigest !== plan.sourceRevisionDigest ||
    observation.ownerAgentId !== plan.ownerAgentId ||
    observation.effectContract !== plan.effectContract ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 5000 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 5000 ||
    Date.parse(now) >= Date.parse(observation.validUntil) ||
    observation.status !== "ready" ||
    !Array.isArray(observation.reasonCodes) ||
    observation.reasonCodes.length !== 0
  )
    throw new Error("The exact owner control readiness is unavailable, blocked or stale.");
}
