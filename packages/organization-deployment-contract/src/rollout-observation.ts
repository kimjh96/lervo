import {
  type OrganizationDeploymentPolicy,
  type OrganizationFleetRolloutPlan,
  type OrganizationFleetWaveObservation,
  type OrganizationNodeEnrollment,
  validateSchema,
} from "@lervo/schemas";

import { assertOrganizationNodeEnrollment } from "./enrollment.js";
import { OrganizationDeploymentError } from "./errors.js";
import { assertOrganizationAuthority } from "./policy.js";
import {
  assertOrganizationFleetRolloutPlan,
  assertRolloutPlanAgainstPolicy,
  calculateOrganizationFleetRolloutPlanHash,
} from "./rollout-plan.js";
import { clone, contentId, isCanonicalOrder, timestamp } from "./shared.js";

type WaveObservationContent = Omit<OrganizationFleetWaveObservation, "observationId">;

export type OrganizationFleetWaveGateState = "ready_to_advance" | "hold" | "rollback_required";

export type OrganizationFleetWaveGateFailure =
  "readiness_incomplete" | "target_runtime_mismatch" | "target_artifact_mismatch";

export function assertOrganizationFleetWaveObservation(
  observation: OrganizationFleetWaveObservation,
): void {
  if (!validateSchema("organizationFleetWaveObservation", observation).valid) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_wave_observation",
      "The organization fleet wave observation contract is invalid.",
    );
  }
  const { observationId: _observationId, ...content } = observation;
  if (
    observation.observationId !== contentId("ofw", content) ||
    !isCanonicalOrder(observation.nodes.map((node) => node.enrollmentId))
  ) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_wave_observation",
      "The fleet wave observation identity or target order is invalid.",
    );
  }
}

export function assertObservationAgainstPlan(input: {
  plan: OrganizationFleetRolloutPlan;
  observation: OrganizationFleetWaveObservation;
}): void {
  assertOrganizationFleetRolloutPlan(input.plan);
  assertOrganizationFleetWaveObservation(input.observation);
  const wave = input.plan.waves[input.observation.waveNumber - 1];
  if (
    input.observation.organizationId !== input.plan.organizationId ||
    input.observation.policyId !== input.plan.policyId ||
    input.observation.rolloutPlanId !== input.plan.rolloutPlanId ||
    input.observation.rolloutPlanHash !== calculateOrganizationFleetRolloutPlanHash(input.plan) ||
    wave === undefined ||
    input.observation.nodes.map((node) => node.enrollmentId).join("\0") !==
      wave.enrollmentIds.join("\0")
  ) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_wave_observation",
      "The wave observation is not bound to the exact rollout wave.",
    );
  }
}

export function createOrganizationFleetWaveObservation(input: {
  policy: OrganizationDeploymentPolicy;
  plan: OrganizationFleetRolloutPlan;
  enrollments: OrganizationNodeEnrollment[];
  waveNumber: number;
  nodes: OrganizationFleetWaveObservation["nodes"];
  observedBy: string;
  observedAt: string;
}): OrganizationFleetWaveObservation {
  assertRolloutPlanAgainstPolicy(input);
  assertOrganizationAuthority({
    policy: input.policy,
    principalId: input.observedBy,
    permission: "deployment.plan",
    projectId: input.plan.target.projectId,
    at: input.observedAt,
  });
  const wave = input.plan.waves[input.waveNumber - 1];
  const enrollmentById = new Map(
    input.enrollments.map((enrollment) => {
      assertOrganizationNodeEnrollment(enrollment);
      return [enrollment.enrollmentId, enrollment] as const;
    }),
  );
  const nodes = input.nodes
    .map(clone)
    .sort((left, right) => left.enrollmentId.localeCompare(right.enrollmentId));
  if (
    wave === undefined ||
    timestamp(input.observedAt) < timestamp(input.plan.plannedAt) ||
    nodes.map((node) => node.enrollmentId).join("\0") !== wave.enrollmentIds.join("\0") ||
    nodes.some((node) => enrollmentById.get(node.enrollmentId)?.nodeId !== node.nodeId)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_fleet_wave_observation",
      "The observed Nodes, wave, or timestamp do not match the rollout plan.",
    );
  }
  const content: WaveObservationContent = {
    schemaVersion: 1,
    organizationId: input.plan.organizationId,
    policyId: input.plan.policyId,
    rolloutPlanId: input.plan.rolloutPlanId,
    rolloutPlanHash: calculateOrganizationFleetRolloutPlanHash(input.plan),
    waveNumber: input.waveNumber,
    nodes,
    observedBy: input.observedBy,
    observedAt: input.observedAt,
    effect: { decision: "not_selected", deployment: "not_executed", rollback: "not_executed" },
  };
  const observation: OrganizationFleetWaveObservation = {
    ...content,
    observationId: contentId("ofw", content),
  };
  assertObservationAgainstPlan({ plan: input.plan, observation });
  return clone(observation);
}

export function evaluateOrganizationFleetWave(input: {
  plan: OrganizationFleetRolloutPlan;
  observation: OrganizationFleetWaveObservation;
}): { state: OrganizationFleetWaveGateState; failures: OrganizationFleetWaveGateFailure[] } {
  assertObservationAgainstPlan(input);
  const failures = new Set<OrganizationFleetWaveGateFailure>();
  for (const node of input.observation.nodes) {
    if (node.runtimeVersion !== input.plan.targetRuntimeVersion) {
      failures.add("target_runtime_mismatch");
    }
    if (node.runtimeArtifactHash !== input.plan.targetArtifactHash) {
      failures.add("target_artifact_mismatch");
    }
    if (
      node.readiness.status !== "ready" ||
      node.readiness.consecutiveObservations <
        input.plan.healthGate.minimumConsecutiveReadyObservations ||
      node.readiness.sync !== "ready" ||
      node.readiness.workstreamReplication !== "ready" ||
      !["ready", "disabled"].includes(node.readiness.workspaceCoordination) ||
      !["ready", "disabled"].includes(node.readiness.remoteControl)
    ) {
      failures.add("readiness_incomplete");
    }
  }
  const ordered = [...failures].sort();
  const rollbackRequired =
    failures.has("target_runtime_mismatch") ||
    failures.has("target_artifact_mismatch") ||
    input.observation.nodes.some((node) =>
      ["degraded", "unavailable", "stale"].includes(node.readiness.status),
    );
  return {
    state: rollbackRequired
      ? "rollback_required"
      : failures.size === 0
        ? "ready_to_advance"
        : "hold",
    failures: ordered,
  };
}
