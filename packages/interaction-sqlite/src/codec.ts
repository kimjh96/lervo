import {
  assertConversationInboundEvent,
  assertConversationOutboundMessage,
  assertConversationParticipationDecision,
} from "@lervo/conversation-contract";
import type {
  ConversationInboundEvent,
  ConversationOutboundMessage,
  ConversationParticipationDecision,
} from "@lervo/schemas";

import { InteractionSQLiteError } from "./errors.js";

export type SQLiteRow = Record<string, unknown>;

export function text(row: SQLiteRow, field: string): string {
  const value = row[field];
  if (typeof value !== "string") {
    throw new InteractionSQLiteError("integrity_failed", `Interaction ${field} is invalid.`);
  }
  return value;
}

export function integer(row: SQLiteRow, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InteractionSQLiteError("integrity_failed", `Interaction ${field} is invalid.`);
  }
  return value;
}

function json(row: SQLiteRow, field: string): unknown {
  try {
    return JSON.parse(text(row, field));
  } catch (error) {
    throw new InteractionSQLiteError("integrity_failed", `Interaction ${field} JSON is invalid.`, {
      cause: error,
    });
  }
}

export function inbound(row: SQLiteRow): ConversationInboundEvent {
  const event = json(row, "event_json") as ConversationInboundEvent;
  try {
    assertConversationInboundEvent(event);
  } catch (error) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The stored conversation event is invalid.",
      {
        cause: error,
      },
    );
  }
  if (
    event.eventId !== text(row, "event_id") ||
    event.target.integrationId !== text(row, "integration_id") ||
    event.target.projectId !== text(row, "project_id") ||
    event.target.conversationId !== text(row, "conversation_id")
  )
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The duplicate conversation event coordinates differ.",
    );
  return structuredClone(event);
}

export function decision(
  row: SQLiteRow,
  event: ConversationInboundEvent,
): ConversationParticipationDecision {
  const value = json(row, "decision_json") as ConversationParticipationDecision;
  try {
    assertConversationParticipationDecision({ decision: value, event });
  } catch (error) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The stored participation decision is invalid.",
      {
        cause: error,
      },
    );
  }
  if (
    value.decisionId !== text(row, "decision_id") ||
    value.eventId !== text(row, "event_id") ||
    value.policyId !== text(row, "policy_id") ||
    value.roleId !== text(row, "role_id") ||
    value.conversationId !== text(row, "conversation_id") ||
    value.action !== text(row, "action") ||
    Date.parse(value.decidedAt) !== integer(row, "decided_at_ms")
  )
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The duplicate participation decision coordinates differ.",
    );
  return structuredClone(value);
}

export function outbound(
  row: SQLiteRow,
  event: ConversationInboundEvent,
): ConversationOutboundMessage {
  const value = json(row, "outbound_json") as ConversationOutboundMessage;
  try {
    assertConversationOutboundMessage({ outbound: value, event });
  } catch (error) {
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The stored conversation outbound is invalid.",
      {
        cause: error,
      },
    );
  }
  if (
    value.outboundId !== text(row, "outbound_id") ||
    value.sourceEventId !== text(row, "source_event_id") ||
    value.policyId !== text(row, "policy_id") ||
    value.actor.roleId !== text(row, "role_id") ||
    value.target.integrationId !== text(row, "integration_id") ||
    value.target.projectId !== text(row, "project_id") ||
    value.target.conversationId !== text(row, "conversation_id")
  )
    throw new InteractionSQLiteError(
      "integrity_failed",
      "The duplicate conversation outbound coordinates differ.",
    );
  return structuredClone(value);
}
