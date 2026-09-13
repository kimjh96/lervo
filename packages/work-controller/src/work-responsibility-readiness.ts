import type {
  WorkerReadinessObservationV1,
  WorkResponsibilityV1,
} from "@lervo/application-contract";

import { digest } from "./hash.js";
import {
  assertWorkResponsibility,
  operatingHashPattern,
  operatingInteger,
  operatingTime,
} from "./operating-contract-validation.js";

export function evaluateWorkResponsibility(input: {
  responsibility: WorkResponsibilityV1;
  current: {
    assignmentId: string;
    assignmentRevision: number;
    executorAgentId: string;
    roleId: string;
    roleVersion: string;
    roleContractHash: string;
    responsibilityBindingHash: string | null;
    liveLease: boolean;
  };
  maximumDeadlineMs: number;
  now: string;
}): { status: "ready" | "blocked"; reasonCodes: string[]; responsibilityHash: string } {
  const { responsibility: target, current } = input;
  assertWorkResponsibility(target);
  if (!operatingTime(input.now) || !operatingInteger(input.maximumDeadlineMs, 1)) {
    throw new TypeError("The responsibility evaluation time or bound is invalid.");
  }
  const reasons: string[] = [];
  if (
    target.assignmentId !== current.assignmentId ||
    target.assignmentRevision !== current.assignmentRevision
  )
    reasons.push("assignment_changed");
  if (
    target.executorAgentId !== current.executorAgentId ||
    target.roleId !== current.roleId ||
    target.roleVersion !== current.roleVersion ||
    target.roleContractHash !== current.roleContractHash
  )
    reasons.push("role_binding_changed");
  if (target.predecessorBindingHash !== current.responsibilityBindingHash)
    reasons.push("responsibility_changed");
  if (current.liveLease) reasons.push("responsibility_lease_unresolved");
  if (
    Date.parse(target.startDeadline) <= Date.parse(input.now) ||
    Date.parse(target.completionDeadline) - Date.parse(input.now) > input.maximumDeadlineMs
  )
    reasons.push("deadline_outside_mandate");
  return {
    status: reasons.length === 0 ? "ready" : "blocked",
    reasonCodes: reasons,
    responsibilityHash: digest(target),
  };
}

export const workerReadinessKinds = [
  "provider",
  "tools",
  "cli",
  "read_scope",
  "write_scope",
  "knowledge",
  "source_policy",
  "verification",
  "budget",
  "workspace",
  "ancestry",
  "lease",
] as const;

export function evaluateWorkerReadiness(input: {
  responsibility: WorkResponsibilityV1;
  observation: WorkerReadinessObservationV1;
  sourceRevisionDigest: string;
  requiredChecks: readonly WorkerReadinessObservationV1["checks"][number]["kind"][];
  now: string;
}): { status: "ready" | "blocked"; reasonCodes: string[]; observationHash: string } {
  assertWorkResponsibility(input.responsibility);
  const { observation, responsibility } = input;
  if (
    observation.schemaVersion !== 1 ||
    !operatingTime(input.now) ||
    !operatingTime(observation.observedAt) ||
    !operatingTime(observation.validUntil) ||
    ![
      observation.sourceRevisionDigest,
      observation.responsibilityArtifactHash,
      input.sourceRevisionDigest,
    ].every((item) => operatingHashPattern.test(item)) ||
    !Array.isArray(observation.checks) ||
    observation.checks.length !== workerReadinessKinds.length ||
    new Set(observation.checks.map((item) => item.kind)).size !== workerReadinessKinds.length ||
    observation.checks.some(
      (item) =>
        !workerReadinessKinds.includes(item.kind) ||
        !["passed", "failed", "unobserved", "not_required"].includes(item.status) ||
        (item.evidenceHash !== null && !operatingHashPattern.test(item.evidenceHash)),
    ) ||
    input.requiredChecks.some((kind) => !workerReadinessKinds.includes(kind))
  ) {
    throw new TypeError("The worker readiness observation is invalid.");
  }
  const reasons: string[] = [];
  if (
    observation.sourceRevisionDigest !== input.sourceRevisionDigest ||
    observation.responsibilityArtifactHash !== digest(responsibility)
  )
    reasons.push("readiness_binding_changed");
  if (
    observation.agentId !== responsibility.executorAgentId ||
    observation.roleId !== responsibility.roleId ||
    observation.roleVersion !== responsibility.roleVersion ||
    observation.roleContractHash !== responsibility.roleContractHash
  )
    reasons.push("worker_binding_changed");
  if (
    Date.parse(observation.observedAt) > Date.parse(input.now) ||
    Date.parse(observation.validUntil) <= Date.parse(input.now)
  )
    reasons.push("readiness_expired");
  const mandatory = new Set([
    ...input.requiredChecks,
    "provider",
    "tools",
    "read_scope",
    "knowledge",
    "verification",
    "budget",
    "workspace",
    "ancestry",
    "lease",
  ]);
  const capabilities = new Set(responsibility.requiredCapabilities);
  if (capabilities.has("shell.execute")) mandatory.add("cli");
  if (capabilities.has("filesystem.write") || capabilities.has("repository.write"))
    mandatory.add("write_scope");
  if (capabilities.has("network.access")) mandatory.add("source_policy");
  for (const check of observation.checks) {
    if (
      check.status === "failed" ||
      check.status === "unobserved" ||
      (mandatory.has(check.kind) && check.status !== "passed") ||
      (check.status === "passed" && check.evidenceHash === null)
    )
      reasons.push(
        `readiness_${check.kind}_${check.status === "passed" ? "evidence_missing" : check.status}`,
      );
  }
  return {
    status: reasons.length === 0 ? "ready" : "blocked",
    reasonCodes: reasons,
    observationHash: digest(observation),
  };
}
