import {
  type OrganizationNodeRolloutDelivery,
  type OrganizationNodeRolloutDeliveryReceipt,
  type OrganizationNodeRolloutRecoveryObservation,
  type OrganizationNodeRolloutRecoveryReceipt,
  type OrganizationProjectTarget,
  type SignedOrganizationNodeRolloutDelivery,
} from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import {
  applyOrganizationNodeRolloutExecution,
  calculateOrganizationNodeRolloutExecutionPlanHash,
  createOrganizationNodeRolloutExecutionPlan,
  type OrganizationNodeRolloutLocalTransactionPort,
} from "./rollout-execution.js";
import {
  assertOrganizationNodeRolloutDeliveryReceipt,
  calculateOrganizationNodeRolloutDeliveryHash,
  createOrganizationNodeRolloutDeliveryReceipt,
} from "./rollout-delivery-integrity.js";
import {
  authorizeOrganizationNodeRolloutDelivery,
  type OrganizationNodeRolloutDeliveryTrustStore,
} from "./rollout-delivery-authorization.js";
import { clone, timestamp } from "./shared.js";
import {
  assertOrganizationNodeRolloutRecoveryObservation,
  assertOrganizationNodeRolloutRecoveryReceipt,
  createOrganizationNodeRolloutRecoveryReceipt,
} from "./rollout-recovery.js";

const DEFAULT_MAXIMUM_LIFETIME_MS = 5 * 60_000;
const MAXIMUM_LIFETIME_MS = 15 * 60_000;
const DEFAULT_CLOCK_SKEW_MS = 30_000;
const MAXIMUM_CLOCK_SKEW_MS = 60_000;

export type OrganizationNodeRolloutDeliveryReplayDecision =
  | { status: "available" }
  | { status: "duplicate"; receipt: OrganizationNodeRolloutDeliveryReceipt }
  | { status: "in_progress" }
  | { status: "idempotency_conflict" }
  | { status: "nonce_replay" };

export type OrganizationNodeRolloutDeliveryReservationDecision =
  | { status: "reserved"; reservationId: string }
  | Exclude<OrganizationNodeRolloutDeliveryReplayDecision, { status: "available" }>;

export type OrganizationNodeRolloutRecoveryStateDecision =
  | {
      status: "recoverable";
      reservationId: string;
      baseline: OrganizationNodeRolloutRecoveryObservation;
      receipt: OrganizationNodeRolloutRecoveryReceipt | null;
    }
  | { status: "baseline_unavailable" }
  | Exclude<OrganizationNodeRolloutDeliveryReplayDecision, { status: "in_progress" }>;

export interface OrganizationNodeRolloutDeliveryReplayStore {
  inspect(input: {
    deliveryHash: string;
    idempotencyKey: string;
    nonce: string;
  }): Promise<OrganizationNodeRolloutDeliveryReplayDecision>;
  reserve(input: {
    deliveryHash: string;
    idempotencyKey: string;
    nonce: string;
    baseline: OrganizationNodeRolloutRecoveryObservation;
  }): Promise<OrganizationNodeRolloutDeliveryReservationDecision>;
  complete(input: {
    reservationId: string;
    receipt: OrganizationNodeRolloutDeliveryReceipt;
  }): Promise<void>;
  inspectRecovery?(input: {
    deliveryHash: string;
    idempotencyKey: string;
    nonce: string;
  }): Promise<OrganizationNodeRolloutRecoveryStateDecision>;
  recordRecovery?(input: {
    reservationId: string;
    receipt: OrganizationNodeRolloutRecoveryReceipt;
  }): Promise<OrganizationNodeRolloutRecoveryReceipt>;
}

function replayFailure(
  status: Exclude<
    OrganizationNodeRolloutDeliveryReplayDecision["status"],
    "available" | "duplicate"
  >,
): never {
  throw new OrganizationDeploymentError(
    status === "in_progress"
      ? "node_rollout_delivery_in_progress"
      : "node_rollout_delivery_replay_rejected",
    status === "in_progress"
      ? "The organization rollout delivery has an unresolved prior execution."
      : "The organization rollout delivery replay coordinates conflict with prior state.",
  );
}

function assertMatchingReceipt(input: {
  receipt: OrganizationNodeRolloutDeliveryReceipt;
  delivery: OrganizationNodeRolloutDelivery;
  deliveryHash: string;
}): void {
  assertOrganizationNodeRolloutDeliveryReceipt(input.receipt);
  if (
    input.receipt.deliveryId !== input.delivery.deliveryId ||
    input.receipt.deliveryHash !== input.deliveryHash ||
    input.receipt.idempotencyKey !== input.delivery.idempotencyKey
  ) {
    throw new OrganizationDeploymentError(
      "node_rollout_delivery_persistence_failed",
      "The stored rollout delivery receipt does not match the signed delivery.",
    );
  }
}

function duration(value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > maximum) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery",
      "The organization rollout delivery timing configuration is invalid.",
    );
  }
  return resolved;
}

export async function applyAuthenticatedOrganizationNodeRolloutDelivery(input: {
  envelope: SignedOrganizationNodeRolloutDelivery;
  nodeId: string;
  destinationId: string;
  target: OrganizationProjectTarget;
  trustStore: OrganizationNodeRolloutDeliveryTrustStore;
  replayStore: OrganizationNodeRolloutDeliveryReplayStore;
  local: OrganizationNodeRolloutLocalTransactionPort;
  now: string;
  maximumLifetimeMs?: number;
  clockSkewMs?: number;
}): Promise<{ status: "executed" | "duplicate"; receipt: OrganizationNodeRolloutDeliveryReceipt }> {
  const delivery = await authorizeOrganizationNodeRolloutDelivery(input);

  const deliveryHash = calculateOrganizationNodeRolloutDeliveryHash(delivery);
  const replay = { deliveryHash, idempotencyKey: delivery.idempotencyKey, nonce: delivery.nonce };
  let inspected: OrganizationNodeRolloutDeliveryReplayDecision;
  try {
    inspected = await input.replayStore.inspect(replay);
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_delivery_persistence_failed",
      "The organization rollout replay state could not be inspected.",
      { cause: error },
    );
  }
  if (inspected.status === "duplicate") {
    assertMatchingReceipt({ receipt: inspected.receipt, delivery, deliveryHash });
    return { status: "duplicate", receipt: clone(inspected.receipt) };
  }
  if (inspected.status !== "available") replayFailure(inspected.status);

  const maximumLifetimeMs = duration(
    input.maximumLifetimeMs,
    DEFAULT_MAXIMUM_LIFETIME_MS,
    MAXIMUM_LIFETIME_MS,
  );
  const clockSkewMs = duration(input.clockSkewMs, DEFAULT_CLOCK_SKEW_MS, MAXIMUM_CLOCK_SKEW_MS);
  const issuedAt = timestamp(delivery.issuedAt);
  const expiresAt = timestamp(delivery.expiresAt);
  const now = timestamp(input.now);
  if (
    !Number.isFinite(now) ||
    expiresAt - issuedAt > maximumLifetimeMs ||
    now + clockSkewMs < issuedAt ||
    now - clockSkewMs > expiresAt
  ) {
    throw new OrganizationDeploymentError(
      "node_rollout_delivery_not_current",
      "The organization rollout delivery is outside its accepted time window.",
    );
  }

  const expectedPlan = await createOrganizationNodeRolloutExecutionPlan({
    policy: delivery.signedPolicy.policy,
    rolloutPlan: delivery.rolloutPlan,
    approval: delivery.approval,
    ...(delivery.observation === null ? {} : { observation: delivery.observation }),
    enrollment: delivery.enrollment,
    executedBy: delivery.executionPlan.executedBy,
    plannedAt: delivery.executionPlan.plannedAt,
    port: input.local,
  });
  if (
    expectedPlan.executionPlanId !== delivery.executionPlan.executionPlanId ||
    calculateOrganizationNodeRolloutExecutionPlanHash(expectedPlan) !==
      calculateOrganizationNodeRolloutExecutionPlanHash(delivery.executionPlan)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery",
      "The signed delivery does not contain the exact current local execution plan.",
    );
  }

  let baseline: OrganizationNodeRolloutRecoveryObservation;
  try {
    baseline =
      input.local.inspectEffect === undefined
        ? {
            localPlanId: delivery.executionPlan.localPlanId,
            localPlanHash: delivery.executionPlan.localPlanHash,
            registry: "unchanged",
            serviceTarget: "other",
            legacyTarget: "conflict",
            privacy: {
              absolutePaths: "excluded",
              credentials: "excluded",
              serviceDefinitionBodies: "excluded",
            },
          }
        : await input.local.inspectEffect({
            executionPlan: clone(delivery.executionPlan),
            enrollment: clone(delivery.enrollment),
          });
    assertOrganizationNodeRolloutRecoveryObservation(baseline);
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_execution_failed",
      "The local rollout recovery baseline could not be obtained.",
      { cause: error },
    );
  }
  if (
    baseline.localPlanId !== delivery.executionPlan.localPlanId ||
    baseline.localPlanHash !== delivery.executionPlan.localPlanHash
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollout_delivery",
      "The local rollout recovery baseline changed before reservation.",
    );
  }

  let reservation: OrganizationNodeRolloutDeliveryReservationDecision;
  try {
    reservation = await input.replayStore.reserve({ ...replay, baseline });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_delivery_persistence_failed",
      "The organization rollout delivery could not be reserved durably.",
      { cause: error },
    );
  }
  if (reservation.status === "duplicate") {
    assertMatchingReceipt({ receipt: reservation.receipt, delivery, deliveryHash });
    return { status: "duplicate", receipt: clone(reservation.receipt) };
  }
  if (reservation.status !== "reserved") replayFailure(reservation.status);

  const executionReceipt = await applyOrganizationNodeRolloutExecution({
    executionPlan: delivery.executionPlan,
    policy: delivery.signedPolicy.policy,
    rolloutPlan: delivery.rolloutPlan,
    approval: delivery.approval,
    ...(delivery.observation === null ? {} : { observation: delivery.observation }),
    enrollment: delivery.enrollment,
    executedAt: input.now,
    port: input.local,
  });
  const receipt = createOrganizationNodeRolloutDeliveryReceipt({ delivery, executionReceipt });
  try {
    await input.replayStore.complete({ reservationId: reservation.reservationId, receipt });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_delivery_persistence_failed",
      "The rollout effect completed but its replay receipt could not be persisted.",
      { cause: error },
    );
  }
  return { status: "executed", receipt: clone(receipt) };
}

export async function recoverAuthenticatedOrganizationNodeRolloutDelivery(input: {
  envelope: SignedOrganizationNodeRolloutDelivery;
  nodeId: string;
  destinationId: string;
  target: OrganizationProjectTarget;
  trustStore: OrganizationNodeRolloutDeliveryTrustStore;
  replayStore: OrganizationNodeRolloutDeliveryReplayStore;
  local: OrganizationNodeRolloutLocalTransactionPort;
  now: string;
}): Promise<{
  status: "inspected" | "duplicate";
  receipt: OrganizationNodeRolloutRecoveryReceipt;
}> {
  const delivery = await authorizeOrganizationNodeRolloutDelivery(input);
  timestamp(input.now);
  const deliveryHash = calculateOrganizationNodeRolloutDeliveryHash(delivery);
  const coordinate = {
    deliveryHash,
    idempotencyKey: delivery.idempotencyKey,
    nonce: delivery.nonce,
  };
  let state: OrganizationNodeRolloutRecoveryStateDecision;
  if (input.replayStore.inspectRecovery === undefined) {
    throw new OrganizationDeploymentError(
      "node_rollout_recovery_unavailable",
      "The rollout replay store does not support recovery inspection.",
    );
  }
  try {
    state = await input.replayStore.inspectRecovery(coordinate);
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_delivery_persistence_failed",
      "The rollout recovery state could not be inspected.",
      { cause: error },
    );
  }
  if (state.status !== "recoverable") {
    throw new OrganizationDeploymentError(
      "node_rollout_recovery_unavailable",
      "The rollout delivery does not have an unresolved reserved execution.",
    );
  }
  if (state.receipt !== null && state.receipt.classification !== "unknown") {
    assertOrganizationNodeRolloutRecoveryReceipt(state.receipt);
    return { status: "duplicate", receipt: clone(state.receipt) };
  }
  let current: OrganizationNodeRolloutRecoveryObservation;
  if (input.local.inspectEffect === undefined) {
    throw new OrganizationDeploymentError(
      "node_rollout_recovery_unavailable",
      "The local rollout adapter does not support exact effect inspection.",
    );
  }
  try {
    current = await input.local.inspectEffect({
      executionPlan: clone(delivery.executionPlan),
      enrollment: clone(delivery.enrollment),
    });
    assertOrganizationNodeRolloutRecoveryObservation(current);
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_recovery_failed",
      "The exact current local rollout state could not be inspected.",
      { cause: error },
    );
  }
  const receipt = createOrganizationNodeRolloutRecoveryReceipt({
    delivery,
    deliveryHash,
    baseline: state.baseline,
    current,
    inspectedAt: input.now,
  });
  let persisted: OrganizationNodeRolloutRecoveryReceipt;
  if (input.replayStore.recordRecovery === undefined) {
    throw new OrganizationDeploymentError(
      "node_rollout_recovery_unavailable",
      "The rollout replay store does not support recovery persistence.",
    );
  }
  try {
    persisted = await input.replayStore.recordRecovery({
      reservationId: state.reservationId,
      receipt,
    });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollout_delivery_persistence_failed",
      "The rollout recovery receipt could not be persisted.",
      { cause: error },
    );
  }
  assertOrganizationNodeRolloutRecoveryReceipt(persisted);
  return {
    status: persisted.recoveryReceiptId === receipt.recoveryReceiptId ? "inspected" : "duplicate",
    receipt: clone(persisted),
  };
}
