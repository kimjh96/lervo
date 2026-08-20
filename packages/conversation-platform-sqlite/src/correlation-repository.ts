import type { DatabaseSync } from "node:sqlite";

import type { ConversationPlatformIdentityPort } from "@lervo/conversation-platform";

import { ConversationPlatformSQLiteError } from "./errors.js";
import {
  assertDepth,
  assertExternal,
  assertIdentifier,
  assertPlatform,
} from "./validation.js";

type InboundRecord = Parameters<ConversationPlatformIdentityPort["recordInbound"]>[0];
type OutboundRecord = Parameters<ConversationPlatformIdentityPort["recordOutbound"]>[0];

interface CorrelationRow {
  reply_event_id: string;
  observed_event_id: string | null;
  outbound_id: string | null;
  automation_depth: number;
}

export class ConversationPlatformCorrelationRepository {
  constructor(private readonly database: DatabaseSync) {}

  recordInbound(input: InboundRecord): void {
    this.validateAddress(input);
    assertIdentifier(input.eventId, "eventId");
    assertDepth(input.automationDepth);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.find(input);
      if (current === null) {
        this.database.prepare(`
          INSERT INTO message_correlations (
            platform, integration_id, tenant_key, conversation_key, external_message_key,
            reply_event_id, observed_event_id, outbound_id, automation_depth
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `).run(input.platform, input.integrationId, input.tenantKey, input.conversationKey,
          input.externalMessageKey, input.eventId, input.eventId, input.automationDepth);
      } else if (current.observed_event_id === null) {
        this.database.prepare(`
          UPDATE message_correlations SET observed_event_id = ?
          WHERE platform = ? AND integration_id = ? AND tenant_key = ?
            AND conversation_key = ? AND external_message_key = ?
        `).run(input.eventId, input.platform, input.integrationId, input.tenantKey,
          input.conversationKey, input.externalMessageKey);
      } else if (current.observed_event_id !== input.eventId) {
        throw this.conflict();
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw this.wrap(error);
    }
  }

  recordOutbound(input: OutboundRecord): void {
    this.validateAddress(input);
    assertIdentifier(input.outboundId, "outboundId");
    assertIdentifier(input.sourceEventId, "eventId");
    assertDepth(input.automationDepth);
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const outbound = this.database.prepare(`
        SELECT platform, integration_id, tenant_key, conversation_key, external_message_key,
          reply_event_id, automation_depth FROM message_correlations WHERE outbound_id = ?
      `).get(input.outboundId) as Record<string, string | number> | undefined;
      if (outbound !== undefined) {
        const expected = [input.platform, input.integrationId, input.tenantKey,
          input.conversationKey, input.externalMessageKey, input.sourceEventId, input.automationDepth];
        const actual = [outbound.platform, outbound.integration_id, outbound.tenant_key,
          outbound.conversation_key, outbound.external_message_key, outbound.reply_event_id,
          outbound.automation_depth];
        if (actual.some((value, index) => value !== expected[index])) throw this.conflict();
      } else {
        const current = this.find(input);
        if (current === null) {
          this.database.prepare(`
            INSERT INTO message_correlations (
              platform, integration_id, tenant_key, conversation_key, external_message_key,
              reply_event_id, observed_event_id, outbound_id, automation_depth
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `).run(input.platform, input.integrationId, input.tenantKey, input.conversationKey,
            input.externalMessageKey, input.sourceEventId, input.outboundId, input.automationDepth);
        } else if (current.outbound_id === null) {
          this.database.prepare(`
            UPDATE message_correlations
            SET reply_event_id = ?, outbound_id = ?, automation_depth = ?
            WHERE platform = ? AND integration_id = ? AND tenant_key = ?
              AND conversation_key = ? AND external_message_key = ?
          `).run(input.sourceEventId, input.outboundId, input.automationDepth,
            input.platform, input.integrationId, input.tenantKey, input.conversationKey,
            input.externalMessageKey);
        } else throw this.conflict();
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw this.wrap(error);
    }
  }

  private find(input: {
    platform: string;
    integrationId: string;
    tenantKey: string;
    conversationKey: string;
    externalMessageKey: string;
  }): CorrelationRow | null {
    return (this.database.prepare(`
      SELECT reply_event_id, observed_event_id, outbound_id, automation_depth
      FROM message_correlations WHERE platform = ? AND integration_id = ? AND tenant_key = ?
        AND conversation_key = ? AND external_message_key = ?
    `).get(input.platform, input.integrationId, input.tenantKey, input.conversationKey,
      input.externalMessageKey) as CorrelationRow | undefined) ?? null;
  }

  private validateAddress(input: {
    platform: string;
    integrationId: string;
    tenantKey: string;
    conversationKey: string;
    externalMessageKey: string;
  }): void {
    assertPlatform(input.platform);
    assertIdentifier(input.integrationId, "integrationId");
    assertExternal(input.tenantKey, "tenant key");
    assertExternal(input.conversationKey, "conversation key");
    assertExternal(input.externalMessageKey, "message key");
  }

  private conflict(): ConversationPlatformSQLiteError {
    return new ConversationPlatformSQLiteError(
      "conflicting_binding",
      "외부 메시지가 서로 다른 Lervo event 또는 outbound에 연결되어 있습니다.",
    );
  }

  private wrap(error: unknown): ConversationPlatformSQLiteError {
    if (error instanceof ConversationPlatformSQLiteError) return error;
    return new ConversationPlatformSQLiteError(
      "write_failed",
      "Conversation message correlation을 저장하지 못했습니다.",
      { cause: error },
    );
  }
}
