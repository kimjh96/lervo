import type { DatabaseSync } from "node:sqlite";

import type {
  ConversationPlatformDeliveryReplayPort,
  PlatformDeliveryReplayDecision,
} from "@lervo/conversation-platform";

import { ConversationPlatformSQLiteError } from "./errors.js";
import {
  assertExternal,
  assertIdentifier,
  assertPlatform,
  assertTimestamp,
} from "./validation.js";

type BeginInput = Parameters<ConversationPlatformDeliveryReplayPort["begin"]>[0];
type CompleteInput = Parameters<ConversationPlatformDeliveryReplayPort["complete"]>[0];
type UnknownInput = Parameters<ConversationPlatformDeliveryReplayPort["markUnknown"]>[0];
type RejectedInput = Parameters<ConversationPlatformDeliveryReplayPort["markRejected"]>[0];

interface ReplayRow {
  request_hash: string;
  status: "sending" | "unknown" | "rejected" | "delivered";
  external_message_key: string | null;
  delivered_at: string | null;
}

export class ConversationPlatformReplayRepository {
  constructor(private readonly database: DatabaseSync) {}

  begin(input: BeginInput): PlatformDeliveryReplayDecision {
    this.validateCoordinate(input);
    assertTimestamp(input.attemptedAt, "attemptedAt");
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.find(input);
      if (current === null) {
        this.database.prepare(`
          INSERT INTO delivery_replay (
            platform, integration_id, outbound_id, request_hash, status, attempted_at,
            external_message_key, delivered_at
          ) VALUES (?, ?, ?, ?, 'sending', ?, NULL, NULL)
        `).run(input.platform, input.integrationId, input.outboundId, input.requestHash,
          input.attemptedAt);
        this.database.exec("COMMIT;");
        return { status: "reserved" };
      }
      this.database.exec("COMMIT;");
      if (current.request_hash !== input.requestHash) return { status: "conflict" };
      if (current.status === "unknown" || current.status === "sending") return { status: "unknown" };
      if (current.status === "rejected") return { status: "rejected" };
      if (current.external_message_key === null || current.delivered_at === null) {
        throw new ConversationPlatformSQLiteError("integrity_failed", "완료된 delivery replay가 손상되었습니다.");
      }
      assertExternal(current.external_message_key, "external message key");
      assertTimestamp(current.delivered_at, "deliveredAt");
      return { status: "delivered", externalMessageKey: current.external_message_key,
        deliveredAt: current.delivered_at };
    } catch (error) {
      try { this.database.exec("ROLLBACK;"); } catch { /* transaction may already be committed */ }
      throw this.wrap(error);
    }
  }

  complete(input: CompleteInput): void {
    this.validateCoordinate(input);
    assertExternal(input.externalMessageKey, "external message key");
    assertTimestamp(input.deliveredAt, "deliveredAt");
    try {
      const result = this.database.prepare(`
        UPDATE delivery_replay SET status = 'delivered', external_message_key = ?, delivered_at = ?
        WHERE platform = ? AND integration_id = ? AND outbound_id = ? AND request_hash = ?
          AND status = 'sending'
      `).run(input.externalMessageKey, input.deliveredAt, input.platform, input.integrationId,
        input.outboundId, input.requestHash);
      if (result.changes === 1) return;
      const current = this.find(input);
      if (current?.status === "delivered" && current.request_hash === input.requestHash &&
        current.external_message_key === input.externalMessageKey &&
        current.delivered_at === input.deliveredAt) return;
      throw new ConversationPlatformSQLiteError("conflicting_binding", "delivery 완료 기록이 기존 값과 다릅니다.");
    } catch (error) {
      throw this.wrap(error);
    }
  }

  markUnknown(input: UnknownInput): void {
    this.validateCoordinate(input);
    try {
      const result = this.database.prepare(`
        UPDATE delivery_replay SET status = 'unknown'
        WHERE platform = ? AND integration_id = ? AND outbound_id = ? AND request_hash = ?
          AND status = 'sending'
      `).run(input.platform, input.integrationId, input.outboundId, input.requestHash);
      if (result.changes === 1) return;
      const current = this.find(input);
      if (current !== null && current.request_hash === input.requestHash &&
        (current.status === "unknown" || current.status === "delivered")) return;
      throw new ConversationPlatformSQLiteError("conflicting_binding", "delivery unknown 기록이 기존 값과 다릅니다.");
    } catch (error) {
      throw this.wrap(error);
    }
  }

  markRejected(input: RejectedInput): void {
    this.markTerminalFailure(input, "rejected");
  }

  private markTerminalFailure(input: RejectedInput, status: "rejected"): void {
    this.validateCoordinate(input);
    try {
      const result = this.database.prepare(`
        UPDATE delivery_replay SET status = ?
        WHERE platform = ? AND integration_id = ? AND outbound_id = ? AND request_hash = ?
          AND status = 'sending'
      `).run(status, input.platform, input.integrationId, input.outboundId, input.requestHash);
      if (result.changes === 1) return;
      const current = this.find(input);
      if (current !== null && current.request_hash === input.requestHash && current.status === status) return;
      throw new ConversationPlatformSQLiteError("conflicting_binding", "delivery 거부 기록이 기존 값과 다릅니다.");
    } catch (error) {
      throw this.wrap(error);
    }
  }

  private find(input: { platform: string; integrationId: string; outboundId: string }): ReplayRow | null {
    return (this.database.prepare(`
      SELECT request_hash, status, external_message_key, delivered_at FROM delivery_replay
      WHERE platform = ? AND integration_id = ? AND outbound_id = ?
    `).get(input.platform, input.integrationId, input.outboundId) as ReplayRow | undefined) ?? null;
  }

  private validateCoordinate(input: {
    platform: string;
    integrationId: string;
    outboundId: string;
    requestHash: string;
  }): void {
    assertPlatform(input.platform);
    assertIdentifier(input.integrationId, "integrationId");
    assertIdentifier(input.outboundId, "outboundId");
    assertIdentifier(input.requestHash, "hash");
  }

  private wrap(error: unknown): ConversationPlatformSQLiteError {
    if (error instanceof ConversationPlatformSQLiteError) return error;
    return new ConversationPlatformSQLiteError(
      "write_failed",
      "Conversation delivery replay를 저장하지 못했습니다.",
      { cause: error },
    );
  }
}
