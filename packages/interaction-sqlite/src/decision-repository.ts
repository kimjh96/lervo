import type { DatabaseSync } from "node:sqlite";

import { assertConversationParticipationDecision } from "@lervo/conversation-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ParticipationWindow } from "@lervo/interaction";
import type {
  ConversationInboundEvent,
  ConversationParticipationDecision,
} from "@lervo/schemas";

import { decision, inbound, text } from "./codec.js";
import { InteractionSQLiteError } from "./errors.js";

function milliseconds(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new InteractionSQLiteError("integrity_failed", `${label} time is invalid.`);
  }
  return result;
}

export class ConversationDecisionSQLiteRepository {
  constructor(private readonly database: DatabaseSync) {}

  window(input: {
    policyId: string;
    conversationId: string;
    at: string;
  }): ParticipationWindow {
    const atMs = milliseconds(input.at, "Participation window");
    const row = this.database.prepare(`
      SELECT MAX(decided_at_ms) AS latest, COUNT(*) AS count
      FROM conversation_participation_decisions
      WHERE policy_id = ? AND conversation_id = ? AND action = 'respond'
        AND decided_at_ms >= ? AND decided_at_ms <= ?
    `).get(input.policyId, input.conversationId, atMs - 3_600_000, atMs);
    const count = row?.count;
    const latest = row?.latest;
    if (typeof count !== "number" || !Number.isSafeInteger(count) ||
      (latest !== null && (typeof latest !== "number" || !Number.isSafeInteger(latest)))) {
      throw new InteractionSQLiteError("integrity_failed", "The participation window aggregate is invalid.");
    }
    return {
      latestResponseAt: latest === null ? null : new Date(latest as number).toISOString(),
      responsesInLastHour: count,
    };
  }

  read(event: ConversationInboundEvent, roleId: string): ConversationParticipationDecision | null {
    const row = this.database.prepare(`
      SELECT * FROM conversation_participation_decisions WHERE event_id = ? AND role_id = ?
    `).get(event.eventId, roleId);
    return row === undefined ? null : decision(row, event);
  }

  insert(input: {
    event: ConversationInboundEvent;
    policyId: string;
    roleId: string;
    value: ConversationParticipationDecision;
  }): void {
    assertConversationParticipationDecision({ decision: input.value, event: input.event });
    if (input.value.policyId !== input.policyId || input.value.roleId !== input.roleId) {
      throw new InteractionSQLiteError("integrity_failed", "The participation decision coordinates differ.");
    }
    this.database.prepare(`
      INSERT INTO conversation_participation_decisions (
        decision_id, event_id, policy_id, role_id, conversation_id, action,
        decided_at_ms, decision_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.value.decisionId,
      input.event.eventId,
      input.value.policyId,
      input.value.roleId,
      input.value.conversationId,
      input.value.action,
      milliseconds(input.value.decidedAt, "Participation decision"),
      canonicalJson(input.value),
    );
  }

  auditAll(): void {
    for (const row of this.database.prepare(
      "SELECT * FROM conversation_participation_decisions ORDER BY decision_id",
    ).all()) {
      const inboxRow = this.database.prepare(
        "SELECT * FROM conversation_inbox WHERE event_id = ? AND role_id = ?",
      ).get(text(row, "event_id"), text(row, "role_id"));
      if (inboxRow === undefined || inboxRow.status !== "completed") {
        throw new InteractionSQLiteError("integrity_failed", "The participation decision has no completed inbox.");
      }
      decision(row, inbound(inboxRow));
    }
  }
}
