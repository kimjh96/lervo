import {
  AssignmentConnectorPortError,
  type AssignmentConnectorDeliveryObservationV1,
  type AssignmentConnectorRoutePlanV1,
} from "@lervo/application-contract";

export type SlackAssignmentDurableStatus =
  "delivered" | "rejected" | "reserved" | "sending" | "unknown";

export interface SlackAssignmentConnectorStateRow {
  outbound_id: string;
  plan_id: string;
  connector_id: string;
  destination_id: string;
  reservation_id: string;
  attempt_digest: string;
  authorization_receipt_hash: string;
  reserved_at: string;
  status: SlackAssignmentDurableStatus;
  attempted_at: string | null;
  delivery_receipt_hash: string | null;
  delivery_key_hash: string | null;
  delivered_at: string | null;
  failure_code: "platform_delivery_rejected" | "platform_delivery_unknown" | null;
}

export const SLACK_ASSIGNMENT_STATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS assignment_connector_delivery (
    outbound_id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    connector_id TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    reservation_id TEXT NOT NULL UNIQUE,
    attempt_digest TEXT NOT NULL,
    authorization_receipt_hash TEXT NOT NULL,
    reserved_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('reserved', 'sending', 'delivered', 'rejected', 'unknown')),
    attempted_at TEXT,
    delivery_receipt_hash TEXT,
    delivery_key_hash TEXT,
    delivered_at TEXT,
    failure_code TEXT CHECK (failure_code IS NULL OR failure_code IN ('platform_delivery_rejected', 'platform_delivery_unknown'))
  );
`;

export function sameSlackAssignmentPlan(
  row: SlackAssignmentConnectorStateRow,
  plan: AssignmentConnectorRoutePlanV1,
): boolean {
  return (
    row.plan_id === plan.planId &&
    row.connector_id === plan.connectorId &&
    row.destination_id === plan.destinationId &&
    row.attempt_digest === plan.attemptDigest
  );
}

export function slackAssignmentObservation(
  row: SlackAssignmentConnectorStateRow,
): AssignmentConnectorDeliveryObservationV1 {
  if (row.status === "reserved" || row.status === "sending" || row.attempted_at === null) {
    throw new AssignmentConnectorPortError(
      "delivery_state_invalid",
      "The durable Slack delivery state has no terminal observation.",
    );
  }
  return {
    schemaVersion: 1,
    planId: row.plan_id,
    outboundId: row.outbound_id,
    connectorId: row.connector_id,
    destinationId: row.destination_id,
    status: row.status,
    reservationId: row.reservation_id,
    attemptDigest: row.attempt_digest,
    deliveryReceiptHash: row.delivery_receipt_hash,
    deliveryKeyHash: row.delivery_key_hash,
    attemptedAt: row.attempted_at,
    deliveredAt: row.delivered_at,
    failureCode: row.failure_code,
  };
}
