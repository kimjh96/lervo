import {
  assertOrganizationNodeRolloutDeliveryReceipt,
  assertOrganizationNodeRolloutRecoveryObservation,
  assertOrganizationNodeRolloutRecoveryReceipt,
  type OrganizationNodeRolloutDeliveryReplayStore,
} from "@lervo/organization-deployment-contract";
import type {
  OrganizationNodeRolloutDeliveryReceipt,
  OrganizationNodeRolloutRecoveryObservation,
  OrganizationNodeRolloutRecoveryReceipt,
} from "@lervo/schemas";
import type { DatabaseSync } from "node:sqlite";

import { OrganizationDeploymentSQLiteError } from "./errors.js";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDEMPOTENCY_PATTERN = /^idk_[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export type ReplayCoordinate = Parameters<OrganizationNodeRolloutDeliveryReplayStore["inspect"]>[0];
export type ReplayReservation = Parameters<
  OrganizationNodeRolloutDeliveryReplayStore["reserve"]
>[0];

export interface ReplayRow extends Record<string, unknown> {
  idempotency_key: string;
  delivery_hash: string;
  nonce: string;
  reservation_id: string;
  receipt_json: string | null;
  baseline_json: string | null;
  recovery_json: string | null;
}

function stringField(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "An organization rollout replay row is invalid.",
    );
  }
  return value;
}

export function assertReplayCoordinate(coordinate: ReplayCoordinate): void {
  if (
    !HASH_PATTERN.test(coordinate.deliveryHash) ||
    !IDEMPOTENCY_PATTERN.test(coordinate.idempotencyKey) ||
    !NONCE_PATTERN.test(coordinate.nonce)
  ) {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "The organization rollout replay coordinate is invalid.",
    );
  }
}

export function decodeReplayRow(row: Record<string, unknown>): ReplayRow {
  const receipt = row.receipt_json;
  const baseline = row.baseline_json;
  const recovery = row.recovery_json;
  if (
    (receipt !== null && typeof receipt !== "string") ||
    (baseline !== null && typeof baseline !== "string") ||
    (recovery !== null && typeof recovery !== "string")
  ) {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "An organization rollout replay receipt is invalid.",
    );
  }
  const decoded: ReplayRow = {
    idempotency_key: stringField(row, "idempotency_key"),
    delivery_hash: stringField(row, "delivery_hash"),
    nonce: stringField(row, "nonce"),
    reservation_id: stringField(row, "reservation_id"),
    receipt_json: receipt,
    baseline_json: baseline,
    recovery_json: recovery,
  };
  assertReplayCoordinate({
    idempotencyKey: decoded.idempotency_key,
    deliveryHash: decoded.delivery_hash,
    nonce: decoded.nonce,
  });
  return decoded;
}

export function decodeRecoveryBaseline(
  row: ReplayRow,
): OrganizationNodeRolloutRecoveryObservation | null {
  if (row.baseline_json === null) return null;
  try {
    const baseline = JSON.parse(row.baseline_json) as OrganizationNodeRolloutRecoveryObservation;
    assertOrganizationNodeRolloutRecoveryObservation(baseline);
    return structuredClone(baseline);
  } catch (error) {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "The organization rollout recovery baseline could not be verified.",
      { cause: error },
    );
  }
}

export function decodeRecoveryReceipt(
  row: ReplayRow,
): OrganizationNodeRolloutRecoveryReceipt | null {
  if (row.recovery_json === null) return null;
  try {
    const receipt = JSON.parse(row.recovery_json) as OrganizationNodeRolloutRecoveryReceipt;
    assertOrganizationNodeRolloutRecoveryReceipt(receipt);
    if (
      receipt.deliveryHash !== row.delivery_hash ||
      receipt.idempotencyKey !== row.idempotency_key
    ) {
      throw new Error("Recovery receipt coordinates differ from the reservation.");
    }
    return structuredClone(receipt);
  } catch (error) {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "The organization rollout recovery receipt could not be verified.",
      { cause: error },
    );
  }
}

export function decodeDeliveryReceipt(
  row: ReplayRow,
): OrganizationNodeRolloutDeliveryReceipt | null {
  if (row.receipt_json === null) return null;
  try {
    const receipt = JSON.parse(row.receipt_json) as OrganizationNodeRolloutDeliveryReceipt;
    assertOrganizationNodeRolloutDeliveryReceipt(receipt);
    if (
      receipt.deliveryHash !== row.delivery_hash ||
      receipt.idempotencyKey !== row.idempotency_key
    ) {
      throw new Error("Delivery receipt coordinates differ from the reservation.");
    }
    return structuredClone(receipt);
  } catch (error) {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "The organization rollout replay receipt could not be verified.",
      { cause: error },
    );
  }
}

export function assertReplayStoreIntegrity(database: DatabaseSync, maximumRecords: number): void {
  if (database.prepare("PRAGMA quick_check;").get()?.quick_check !== "ok") {
    throw new OrganizationDeploymentSQLiteError(
      "integrity_failed",
      "The organization rollout replay database failed its integrity check.",
    );
  }
  const rows = database
    .prepare(
      `SELECT idempotency_key, delivery_hash, nonce, reservation_id, receipt_json,
              baseline_json, recovery_json
       FROM organization_rollout_replay`,
    )
    .all();
  if (rows.length > maximumRecords) {
    throw new OrganizationDeploymentSQLiteError(
      "capacity_exceeded",
      "The organization rollout replay store exceeds its fixed capacity.",
    );
  }
  for (const row of rows) {
    const decoded = decodeReplayRow(row);
    decodeDeliveryReceipt(decoded);
    decodeRecoveryBaseline(decoded);
    decodeRecoveryReceipt(decoded);
  }
}
