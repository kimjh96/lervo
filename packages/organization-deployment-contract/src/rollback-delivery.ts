import type {
  OrganizationNodeRollbackDeliveryReceipt,
  OrganizationNodeRollbackRecoveryReceipt,
  OrganizationNodeRolloutRecoveryObservation,
  OrganizationProjectTarget,
  SignedOrganizationNodeRollbackDelivery,
} from "@lervo/schemas";

import { OrganizationDeploymentError } from "./errors.js";
import { authorizeOrganizationNodeRollbackDelivery } from "./rollback-delivery-authorization.js";
import {
  assertMatchingOrganizationNodeRollbackDeliveryReceipt,
  assertOrganizationNodeRollbackRecoveryReceipt,
  calculateOrganizationNodeRollbackDeliveryHash,
  createOrganizationNodeRollbackDeliveryReceipt,
  createOrganizationNodeRollbackRecoveryReceipt,
} from "./rollback-delivery-integrity.js";
import type { OrganizationNodeRolloutDeliveryTrustStore } from "./rollout-delivery-authorization.js";
import { assertOrganizationNodeRolloutRecoveryObservation } from "./rollout-recovery.js";
import {
  applyOrganizationNodeRolloutRollback,
  calculateOrganizationNodeRolloutRollbackPlanHash,
  createOrganizationNodeRolloutRollbackPlan,
  type OrganizationNodeRolloutLocalRollbackPort,
} from "./rollout-rollback.js";
import { clone, timestamp } from "./shared.js";

const DEFAULT_MAXIMUM_LIFETIME_MS = 5 * 60_000;
const MAXIMUM_LIFETIME_MS = 15 * 60_000;
const DEFAULT_CLOCK_SKEW_MS = 30_000;
const MAXIMUM_CLOCK_SKEW_MS = 60_000;

export type OrganizationNodeRollbackDeliveryReplayDecision =
  | { status: "available" }
  | { status: "duplicate"; receipt: OrganizationNodeRollbackDeliveryReceipt }
  | { status: "in_progress" }
  | { status: "idempotency_conflict" }
  | { status: "nonce_replay" };

export type OrganizationNodeRollbackDeliveryReservationDecision =
  | { status: "reserved"; reservationId: string }
  | Exclude<OrganizationNodeRollbackDeliveryReplayDecision, { status: "available" }>;

export type OrganizationNodeRollbackRecoveryStateDecision =
  | {
      status: "recoverable";
      reservationId: string;
      baseline: OrganizationNodeRolloutRecoveryObservation;
      receipt: OrganizationNodeRollbackRecoveryReceipt | null;
    }
  | { status: "baseline_unavailable" }
  | Exclude<OrganizationNodeRollbackDeliveryReplayDecision, { status: "in_progress" }>;

export interface OrganizationNodeRollbackDeliveryReplayStore {
  inspect(input: {
    deliveryHash: string;
    idempotencyKey: string;
    nonce: string;
  }): Promise<OrganizationNodeRollbackDeliveryReplayDecision>;
  reserve(input: {
    deliveryHash: string;
    idempotencyKey: string;
    nonce: string;
    baseline: OrganizationNodeRolloutRecoveryObservation;
  }): Promise<OrganizationNodeRollbackDeliveryReservationDecision>;
  complete(input: {
    reservationId: string;
    receipt: OrganizationNodeRollbackDeliveryReceipt;
  }): Promise<void>;
  inspectRecovery(input: {
    deliveryHash: string;
    idempotencyKey: string;
    nonce: string;
  }): Promise<OrganizationNodeRollbackRecoveryStateDecision>;
  recordRecovery(input: {
    reservationId: string;
    receipt: OrganizationNodeRollbackRecoveryReceipt;
  }): Promise<OrganizationNodeRollbackRecoveryReceipt>;
}

function duration(value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > maximum) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery",
      "The organization rollback delivery timing configuration is invalid.",
    );
  }
  return resolved;
}

function replayFailure(
  status: Exclude<
    OrganizationNodeRollbackDeliveryReplayDecision["status"],
    "available" | "duplicate"
  >,
): never {
  throw new OrganizationDeploymentError(
    status === "in_progress"
      ? "node_rollback_delivery_in_progress"
      : "node_rollback_delivery_replay_rejected",
    status === "in_progress"
      ? "The organization rollback delivery has an unresolved prior execution."
      : "The organization rollback delivery replay coordinates conflict with prior state.",
  );
}

export async function applyAuthenticatedOrganizationNodeRollbackDelivery(input: {
  envelope: SignedOrganizationNodeRollbackDelivery;
  nodeId: string;
  destinationId: string;
  target: OrganizationProjectTarget;
  trustStore: OrganizationNodeRolloutDeliveryTrustStore;
  replayStore: OrganizationNodeRollbackDeliveryReplayStore;
  local: OrganizationNodeRolloutLocalRollbackPort;
  now: string;
  maximumLifetimeMs?: number;
  clockSkewMs?: number;
}): Promise<{
  status: "executed" | "duplicate";
  receipt: OrganizationNodeRollbackDeliveryReceipt;
}> {
  const delivery = await authorizeOrganizationNodeRollbackDelivery(input);
  const deliveryHash = calculateOrganizationNodeRollbackDeliveryHash(delivery);
  const coordinate = {
    deliveryHash,
    idempotencyKey: delivery.idempotencyKey,
    nonce: delivery.nonce,
  };
  let inspected: OrganizationNodeRollbackDeliveryReplayDecision;
  try {
    inspected = await input.replayStore.inspect(coordinate);
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollback_delivery_persistence_failed",
      "The rollback replay state could not be inspected.",
      { cause: error },
    );
  }
  if (inspected.status === "duplicate") {
    assertMatchingOrganizationNodeRollbackDeliveryReceipt({
      receipt: inspected.receipt,
      delivery,
      deliveryHash,
    });
    return { status: "duplicate", receipt: clone(inspected.receipt) };
  }
  if (inspected.status !== "available") replayFailure(inspected.status);
  const issuedAt = timestamp(delivery.issuedAt);
  const expiresAt = timestamp(delivery.expiresAt);
  const now = timestamp(input.now);
  if (
    expiresAt - issuedAt >
      duration(input.maximumLifetimeMs, DEFAULT_MAXIMUM_LIFETIME_MS, MAXIMUM_LIFETIME_MS) ||
    now + duration(input.clockSkewMs, DEFAULT_CLOCK_SKEW_MS, MAXIMUM_CLOCK_SKEW_MS) < issuedAt ||
    now - duration(input.clockSkewMs, DEFAULT_CLOCK_SKEW_MS, MAXIMUM_CLOCK_SKEW_MS) > expiresAt
  ) {
    throw new OrganizationDeploymentError(
      "node_rollback_delivery_not_current",
      "The organization rollback delivery is outside its accepted time window.",
    );
  }
  const expectedPlan = await createOrganizationNodeRolloutRollbackPlan({
    policy: delivery.signedPolicy.policy,
    rolloutPlan: delivery.rolloutPlan,
    approval: delivery.approval,
    observation: delivery.observation,
    enrollment: delivery.enrollment,
    rolledBackBy: delivery.rollbackPlan.rolledBackBy,
    plannedAt: delivery.rollbackPlan.plannedAt,
    port: input.local,
  });
  if (
    expectedPlan.rollbackPlanId !== delivery.rollbackPlan.rollbackPlanId ||
    calculateOrganizationNodeRolloutRollbackPlanHash(expectedPlan) !==
      calculateOrganizationNodeRolloutRollbackPlanHash(delivery.rollbackPlan)
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery",
      "The signed delivery does not contain the exact current rollback plan.",
    );
  }
  if (input.local.inspectEffect === undefined) {
    throw new OrganizationDeploymentError(
      "node_rollback_recovery_unavailable",
      "The installed rollback adapter does not support exact effect inspection.",
    );
  }
  const baseline = await input.local.inspectEffect({
    rollbackPlan: clone(delivery.rollbackPlan),
    enrollment: clone(delivery.enrollment),
  });
  assertOrganizationNodeRolloutRecoveryObservation(baseline);
  if (
    baseline.localPlanId !== delivery.rollbackPlan.localPlanId ||
    baseline.localPlanHash !== delivery.rollbackPlan.localPlanHash
  ) {
    throw new OrganizationDeploymentError(
      "invalid_node_rollback_delivery",
      "The local rollback recovery baseline changed before reservation.",
    );
  }
  let reservation: OrganizationNodeRollbackDeliveryReservationDecision;
  try {
    reservation = await input.replayStore.reserve({ ...coordinate, baseline });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollback_delivery_persistence_failed",
      "The rollback delivery could not be reserved durably.",
      { cause: error },
    );
  }
  if (reservation.status === "duplicate") {
    assertMatchingOrganizationNodeRollbackDeliveryReceipt({
      receipt: reservation.receipt,
      delivery,
      deliveryHash,
    });
    return { status: "duplicate", receipt: clone(reservation.receipt) };
  }
  if (reservation.status !== "reserved") replayFailure(reservation.status);
  const rollbackReceipt = await applyOrganizationNodeRolloutRollback({
    rollbackPlan: delivery.rollbackPlan,
    policy: delivery.signedPolicy.policy,
    rolloutPlan: delivery.rolloutPlan,
    approval: delivery.approval,
    observation: delivery.observation,
    enrollment: delivery.enrollment,
    rolledBackAt: input.now,
    port: input.local,
  });
  const receipt = createOrganizationNodeRollbackDeliveryReceipt({ delivery, rollbackReceipt });
  try {
    await input.replayStore.complete({ reservationId: reservation.reservationId, receipt });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollback_delivery_persistence_failed",
      "The rollback effect completed but its replay receipt could not be persisted.",
      { cause: error },
    );
  }
  return { status: "executed", receipt: clone(receipt) };
}

export async function recoverAuthenticatedOrganizationNodeRollbackDelivery(input: {
  envelope: SignedOrganizationNodeRollbackDelivery;
  nodeId: string;
  destinationId: string;
  target: OrganizationProjectTarget;
  trustStore: OrganizationNodeRolloutDeliveryTrustStore;
  replayStore: OrganizationNodeRollbackDeliveryReplayStore;
  local: OrganizationNodeRolloutLocalRollbackPort;
  now: string;
}): Promise<{
  status: "inspected" | "duplicate";
  receipt: OrganizationNodeRollbackRecoveryReceipt;
}> {
  const delivery = await authorizeOrganizationNodeRollbackDelivery(input);
  timestamp(input.now);
  const deliveryHash = calculateOrganizationNodeRollbackDeliveryHash(delivery);
  const state = await input.replayStore.inspectRecovery({
    deliveryHash,
    idempotencyKey: delivery.idempotencyKey,
    nonce: delivery.nonce,
  });
  if (state.status !== "recoverable") {
    throw new OrganizationDeploymentError(
      "node_rollback_recovery_unavailable",
      "The rollback delivery does not have an unresolved reserved execution.",
    );
  }
  if (state.receipt !== null && state.receipt.classification !== "unknown") {
    assertOrganizationNodeRollbackRecoveryReceipt(state.receipt);
    return { status: "duplicate", receipt: clone(state.receipt) };
  }
  if (input.local.inspectEffect === undefined) {
    throw new OrganizationDeploymentError(
      "node_rollback_recovery_unavailable",
      "The installed rollback adapter does not support exact effect inspection.",
    );
  }
  let current: OrganizationNodeRolloutRecoveryObservation;
  try {
    current = await input.local.inspectEffect({
      rollbackPlan: clone(delivery.rollbackPlan),
      enrollment: clone(delivery.enrollment),
    });
    assertOrganizationNodeRolloutRecoveryObservation(current);
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollback_recovery_failed",
      "The exact current rollback state could not be inspected.",
      { cause: error },
    );
  }
  const receipt = createOrganizationNodeRollbackRecoveryReceipt({
    delivery,
    deliveryHash,
    baseline: state.baseline,
    current,
    inspectedAt: input.now,
  });
  let persisted: OrganizationNodeRollbackRecoveryReceipt;
  try {
    persisted = await input.replayStore.recordRecovery({
      reservationId: state.reservationId,
      receipt,
    });
  } catch (error) {
    throw new OrganizationDeploymentError(
      "node_rollback_delivery_persistence_failed",
      "The rollback recovery receipt could not be persisted.",
      { cause: error },
    );
  }
  assertOrganizationNodeRollbackRecoveryReceipt(persisted);
  return {
    status: persisted.recoveryReceiptId === receipt.recoveryReceiptId ? "inspected" : "duplicate",
    receipt: clone(persisted),
  };
}
