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
    throw new InteractionSQLiteError("integrity_failed", `Interaction ${field}가 유효하지 않습니다.`);
  }
  return value;
}

export function integer(row: SQLiteRow, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InteractionSQLiteError("integrity_failed", `Interaction ${field}가 유효하지 않습니다.`);
  }
  return value;
}

function json(row: SQLiteRow, field: string): unknown {
  try {
    return JSON.parse(text(row, field));
  } catch (error) {
    throw new InteractionSQLiteError("integrity_failed", `Interaction ${field} JSON이 유효하지 않습니다.`, {
      cause: error,
    });
  }
}

export function inbound(row: SQLiteRow): ConversationInboundEvent {
  const event = json(row, "event_json") as ConversationInboundEvent;
  try {
    assertConversationInboundEvent(event);
  } catch (error) {
    throw new InteractionSQLiteError("integrity_failed", "저장된 conversation event가 유효하지 않습니다.", {
      cause: error,
    });
  }
  if (
    event.eventId !== text(row, "event_id") ||
    event.target.integrationId !== text(row, "integration_id") ||
    event.target.projectId !== text(row, "project_id") ||
    event.target.conversationId !== text(row, "conversation_id")
  ) throw new InteractionSQLiteError("integrity_failed", "Conversation event 중복 좌표가 다릅니다.");
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
    throw new InteractionSQLiteError("integrity_failed", "저장된 participation decision이 유효하지 않습니다.", {
      cause: error,
    });
  }
  if (
    value.decisionId !== text(row, "decision_id") || value.eventId !== text(row, "event_id") ||
    value.policyId !== text(row, "policy_id") ||
    value.roleId !== text(row, "role_id") ||
    value.conversationId !== text(row, "conversation_id") ||
    value.action !== text(row, "action") ||
    Date.parse(value.decidedAt) !== integer(row, "decided_at_ms")
  ) throw new InteractionSQLiteError("integrity_failed", "Participation decision 중복 좌표가 다릅니다.");
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
    throw new InteractionSQLiteError("integrity_failed", "저장된 conversation outbound가 유효하지 않습니다.", {
      cause: error,
    });
  }
  if (
    value.outboundId !== text(row, "outbound_id") ||
    value.sourceEventId !== text(row, "source_event_id") ||
    value.policyId !== text(row, "policy_id") ||
    value.actor.roleId !== text(row, "role_id") ||
    value.target.integrationId !== text(row, "integration_id") ||
    value.target.projectId !== text(row, "project_id") ||
    value.target.conversationId !== text(row, "conversation_id")
  ) throw new InteractionSQLiteError("integrity_failed", "Conversation outbound 중복 좌표가 다릅니다.");
  return structuredClone(value);
}
