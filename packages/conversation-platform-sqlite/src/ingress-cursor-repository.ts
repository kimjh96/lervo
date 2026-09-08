import type { DatabaseSync } from "node:sqlite";

import type { ConversationPlatformIngressCursorPort } from "@lervo/conversation-platform";

import { ConversationPlatformSQLiteError } from "./errors.js";
import { assertExternal, assertIdentifier, assertPlatform } from "./validation.js";

type CursorAddress = Parameters<ConversationPlatformIngressCursorPort["readIngressCursor"]>[0];
type CursorAdvance = Parameters<ConversationPlatformIngressCursorPort["advanceIngressCursor"]>[0];

export class ConversationPlatformIngressCursorRepository {
  constructor(private readonly database: DatabaseSync) {}

  read(input: CursorAddress): string | null {
    this.validateAddress(input);
    const row = this.database
      .prepare(
        `
          SELECT cursor FROM ingress_cursors
          WHERE platform = ? AND integration_id = ? AND tenant_key = ? AND conversation_key = ?
        `,
      )
      .get(input.platform, input.integrationId, input.tenantKey, input.conversationKey) as
      { cursor: string } | undefined;
    return row?.cursor ?? null;
  }

  advance(input: CursorAdvance): void {
    this.validateAddress(input);
    assertExternal(input.cursor, "ingress cursor");
    if (input.expectedCursor !== null) assertExternal(input.expectedCursor, "expected cursor");
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const current = this.read(input);
      if (current === input.cursor) {
        this.database.exec("COMMIT;");
        return;
      }
      if (current !== input.expectedCursor) {
        throw new ConversationPlatformSQLiteError(
          "conflicting_binding",
          "The conversation ingress cursor changed before it could advance.",
        );
      }
      if (current === null) {
        this.database
          .prepare(
            `
              INSERT INTO ingress_cursors (
                platform, integration_id, tenant_key, conversation_key, cursor
              ) VALUES (?, ?, ?, ?, ?)
            `,
          )
          .run(
            input.platform,
            input.integrationId,
            input.tenantKey,
            input.conversationKey,
            input.cursor,
          );
      } else {
        this.database
          .prepare(
            `
              UPDATE ingress_cursors SET cursor = ?
              WHERE platform = ? AND integration_id = ? AND tenant_key = ? AND conversation_key = ?
            `,
          )
          .run(
            input.cursor,
            input.platform,
            input.integrationId,
            input.tenantKey,
            input.conversationKey,
          );
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      if (error instanceof ConversationPlatformSQLiteError) throw error;
      throw new ConversationPlatformSQLiteError(
        "write_failed",
        "The conversation ingress cursor could not be saved.",
        { cause: error },
      );
    }
  }

  private validateAddress(input: CursorAddress): void {
    assertPlatform(input.platform);
    assertIdentifier(input.integrationId, "integrationId");
    assertExternal(input.tenantKey, "tenant key");
    assertExternal(input.conversationKey, "conversation key");
  }
}
