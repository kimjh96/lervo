import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type {
  PlatformInboundIdentity,
  PlatformInboundIdentityRequest,
  PlatformOutboundAddress,
} from "@lervo/conversation-platform";
import type { ConversationOutboundMessage, ConversationTarget } from "@lervo/schemas";

import { ConversationPlatformSQLiteError } from "./errors.js";
import type {
  ConversationPlatformConversationBinding,
  ConversationPlatformParticipantBinding,
  ConversationPlatformThreadBinding,
} from "./types.js";
import { assertExternal, assertIdentifier, assertPlatform } from "./validation.js";

interface ConversationRow {
  project_id: string;
  conversation_id: string;
}

interface ActorRow {
  actor_kind: "human" | "agent" | "system";
  participant_id: string;
  role_id: string | null;
}

export class ConversationPlatformBindingRepository {
  private activeConversations = new Set<string>();
  private activeOutboundConversations = new Set<string>();
  private activeParticipants = new Set<string>();

  constructor(private readonly database: DatabaseSync) {}

  install(input: {
    conversations: readonly ConversationPlatformConversationBinding[];
    participants: readonly ConversationPlatformParticipantBinding[];
    threads: readonly ConversationPlatformThreadBinding[];
  }): void {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      for (const binding of input.conversations) this.installConversation(binding);
      for (const binding of input.participants) this.installParticipant(binding);
      for (const binding of input.threads) this.installThread(binding);
      this.database.exec("COMMIT;");
      this.activeConversations = new Set(
        input.conversations.map((binding) => this.externalConversationKey(binding)),
      );
      this.activeOutboundConversations = new Set(
        input.conversations.map((binding) =>
          JSON.stringify([
            binding.platform,
            binding.integrationId,
            binding.projectId,
            binding.conversationId,
          ]),
        ),
      );
      this.activeParticipants = new Set(
        input.participants.map((binding) => this.participantKey(binding)),
      );
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  private installConversation(binding: ConversationPlatformConversationBinding): void {
    assertPlatform(binding.platform);
    assertIdentifier(binding.integrationId, "integrationId");
    assertExternal(binding.tenantKey, "tenant key");
    assertExternal(binding.conversationKey, "conversation key");
    assertIdentifier(binding.projectId, "projectId");
    assertIdentifier(binding.conversationId, "conversationId");
    this.insertIdempotent({
      table: "conversation_bindings",
      columns: [
        "platform",
        "integration_id",
        "tenant_key",
        "conversation_key",
        "project_id",
        "conversation_id",
      ],
      keyColumns: ["platform", "integration_id", "tenant_key", "conversation_key"],
      values: [
        binding.platform,
        binding.integrationId,
        binding.tenantKey,
        binding.conversationKey,
        binding.projectId,
        binding.conversationId,
      ],
    });
  }

  private installParticipant(binding: ConversationPlatformParticipantBinding): void {
    assertPlatform(binding.platform);
    assertIdentifier(binding.integrationId, "integrationId");
    assertExternal(binding.tenantKey, "tenant key");
    assertExternal(binding.participantKey, "participant key");
    assertIdentifier(binding.actor.participantId, "participantId");
    if (binding.actor.kind === "agent") {
      if (binding.actor.roleId === null) throw this.conflict("agent role");
      assertIdentifier(binding.actor.roleId, "roleId");
    } else if (binding.actor.roleId !== null) throw this.conflict("non-agent role");
    this.insertIdempotent({
      table: "participant_bindings",
      columns: [
        "platform",
        "integration_id",
        "tenant_key",
        "participant_key",
        "actor_kind",
        "participant_id",
        "role_id",
      ],
      keyColumns: ["platform", "integration_id", "tenant_key", "participant_key"],
      values: [
        binding.platform,
        binding.integrationId,
        binding.tenantKey,
        binding.participantKey,
        binding.actor.kind,
        binding.actor.participantId,
        binding.actor.roleId,
      ],
    });
  }

  private installThread(binding: ConversationPlatformThreadBinding): void {
    assertPlatform(binding.platform);
    assertIdentifier(binding.integrationId, "integrationId");
    assertExternal(binding.tenantKey, "tenant key");
    assertExternal(binding.conversationKey, "conversation key");
    assertExternal(binding.threadKey, "thread key");
    assertIdentifier(binding.threadId, "threadId");
    this.insertIdempotent({
      table: "thread_bindings",
      columns: [
        "platform",
        "integration_id",
        "tenant_key",
        "conversation_key",
        "thread_key",
        "thread_id",
      ],
      keyColumns: ["platform", "integration_id", "tenant_key", "conversation_key", "thread_key"],
      values: [
        binding.platform,
        binding.integrationId,
        binding.tenantKey,
        binding.conversationKey,
        binding.threadKey,
        binding.threadId,
      ],
    });
  }

  private insertIdempotent(input: {
    table: string;
    columns: readonly string[];
    keyColumns: readonly string[];
    values: readonly (string | null)[];
  }): void {
    const placeholders = input.columns.map(() => "?").join(", ");
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO ${input.table} (${input.columns.join(", ")}) VALUES (${placeholders})`,
      )
      .run(...input.values);
    if (result.changes === 1) return;
    const conditions = input.keyColumns.map((column) => `${column} = ?`).join(" AND ");
    const keyValues = input.keyColumns.map(
      (column) => input.values[input.columns.indexOf(column)]!,
    );
    const existing = this.database
      .prepare(`SELECT ${input.columns.join(", ")} FROM ${input.table} WHERE ${conditions}`)
      .get(...keyValues);
    const expected = Object.fromEntries(
      input.columns.map((column, index) => [column, input.values[index]]),
    );
    if (
      existing === undefined ||
      input.columns.some((column) => existing[column] !== expected[column])
    ) {
      throw this.conflict(input.table);
    }
  }

  mapInbound(input: PlatformInboundIdentityRequest): PlatformInboundIdentity {
    if (!this.activeConversations.has(this.externalConversationKey(input))) {
      throw this.notFound("active conversation");
    }
    const conversation = this.database
      .prepare(
        `
      SELECT project_id, conversation_id FROM conversation_bindings
      WHERE platform = ? AND integration_id = ? AND tenant_key = ? AND conversation_key = ?
    `,
      )
      .get(input.platform, input.integrationId, input.tenantKey, input.conversationKey) as
      ConversationRow | undefined;
    if (conversation === undefined) throw this.notFound("conversation");
    const actor = this.actor(
      input.platform,
      input.integrationId,
      input.tenantKey,
      input.participantKey,
    );
    if (actor.actor_kind !== input.actorKindHint) throw this.conflict("actor kind");
    const mentions = input.mentionedParticipantKeys
      .map((key) => this.optionalActor(input.platform, input.integrationId, input.tenantKey, key))
      .filter((value): value is ActorRow => value !== null);
    const source = this.correlation(input, input.sourceMessageKey);
    const reply =
      input.replyToMessageKey === null ? null : this.correlation(input, input.replyToMessageKey);
    return {
      projectId: conversation.project_id,
      conversationId: conversation.conversation_id,
      threadId: input.threadKey === null ? null : this.resolveThread(input),
      actor: { kind: actor.actor_kind, participantId: actor.participant_id, roleId: actor.role_id },
      mentions: {
        roleIds: [
          ...new Set(mentions.flatMap((value) => (value.role_id === null ? [] : [value.role_id]))),
        ].sort(),
        participantIds: [...new Set(mentions.map((value) => value.participant_id))].sort(),
      },
      replyToEventId: reply?.reply_event_id ?? null,
      automationDepth: source?.automation_depth ?? (actor.actor_kind === "agent" ? 8 : 0),
    };
  }

  mapOutbound(input: {
    platform: import("@lervo/conversation-platform").ConversationPlatformKind;
    integrationId: string;
    target: ConversationTarget;
    actor: ConversationOutboundMessage["actor"];
  }): PlatformOutboundAddress {
    if (
      !this.activeOutboundConversations.has(
        JSON.stringify([
          input.platform,
          input.integrationId,
          input.target.projectId,
          input.target.conversationId,
        ]),
      )
    )
      throw this.notFound("active outbound conversation");
    const row = this.database
      .prepare(
        `
      SELECT tenant_key, conversation_key FROM conversation_bindings
      WHERE platform = ? AND integration_id = ? AND project_id = ? AND conversation_id = ?
    `,
      )
      .get(
        input.platform,
        input.integrationId,
        input.target.projectId,
        input.target.conversationId,
      ) as { tenant_key: string; conversation_key: string } | undefined;
    if (row === undefined) throw this.notFound("outbound conversation");
    if (input.target.threadId === null) {
      return {
        tenantKey: row.tenant_key,
        conversationKey: row.conversation_key,
        threadKey: null,
        replyToMessageKey: null,
      };
    }
    const thread = this.database
      .prepare(
        `
      SELECT thread_key FROM thread_bindings
      WHERE platform = ? AND integration_id = ? AND thread_id = ?
    `,
      )
      .get(input.platform, input.integrationId, input.target.threadId) as
      { thread_key: string } | undefined;
    if (thread === undefined) throw this.notFound("outbound thread");
    return {
      tenantKey: row.tenant_key,
      conversationKey: row.conversation_key,
      threadKey: thread.thread_key,
      replyToMessageKey: thread.thread_key,
    };
  }

  private resolveThread(input: PlatformInboundIdentityRequest): string {
    const existing = this.database
      .prepare(
        `
      SELECT thread_id FROM thread_bindings WHERE platform = ? AND integration_id = ?
        AND tenant_key = ? AND conversation_key = ? AND thread_key = ?
    `,
      )
      .get(
        input.platform,
        input.integrationId,
        input.tenantKey,
        input.conversationKey,
        input.threadKey,
      ) as { thread_id: string } | undefined;
    if (existing !== undefined) {
      assertIdentifier(existing.thread_id, "threadId");
      return existing.thread_id;
    }
    const digest = createHash("sha256")
      .update(
        JSON.stringify([
          input.platform,
          input.integrationId,
          input.tenantKey,
          input.conversationKey,
          input.threadKey,
        ]),
      )
      .digest("hex");
    const threadId = `thd_${digest}`;
    this.installThread({ ...input, threadKey: input.threadKey!, threadId });
    return threadId;
  }

  private actor(
    platform: string,
    integrationId: string,
    tenantKey: string,
    participantKey: string,
  ): ActorRow {
    const value = this.optionalActor(platform, integrationId, tenantKey, participantKey);
    if (value === null) throw this.notFound("participant");
    return value;
  }

  private optionalActor(
    platform: string,
    integrationId: string,
    tenantKey: string,
    participantKey: string,
  ): ActorRow | null {
    if (
      !this.activeParticipants.has(
        JSON.stringify([platform, integrationId, tenantKey, participantKey]),
      )
    )
      return null;
    return (
      (this.database
        .prepare(
          `
      SELECT actor_kind, participant_id, role_id FROM participant_bindings
      WHERE platform = ? AND integration_id = ? AND tenant_key = ? AND participant_key = ?
    `,
        )
        .get(platform, integrationId, tenantKey, participantKey) as ActorRow | undefined) ?? null
    );
  }

  private correlation(
    input: PlatformInboundIdentityRequest,
    key: string,
  ): { reply_event_id: string; automation_depth: number } | null {
    const value =
      (this.database
        .prepare(
          `
      SELECT reply_event_id, automation_depth FROM message_correlations
      WHERE platform = ? AND integration_id = ? AND tenant_key = ?
        AND conversation_key = ? AND external_message_key = ?
    `,
        )
        .get(input.platform, input.integrationId, input.tenantKey, input.conversationKey, key) as
        { reply_event_id: string; automation_depth: number } | undefined) ?? null;
    if (value !== null) {
      assertIdentifier(value.reply_event_id, "eventId");
    }
    return value;
  }

  private externalConversationKey(input: {
    platform: string;
    integrationId: string;
    tenantKey?: string;
    conversationKey?: string;
    projectId?: string;
    conversationId?: string;
  }): string {
    return input.tenantKey === undefined
      ? JSON.stringify([input.platform, input.integrationId, input.projectId, input.conversationId])
      : JSON.stringify([
          input.platform,
          input.integrationId,
          input.tenantKey,
          input.conversationKey,
        ]);
  }

  private participantKey(input: {
    platform: string;
    integrationId: string;
    tenantKey: string;
    participantKey: string;
  }): string {
    return JSON.stringify([
      input.platform,
      input.integrationId,
      input.tenantKey,
      input.participantKey,
    ]);
  }

  private notFound(label: string): ConversationPlatformSQLiteError {
    return new ConversationPlatformSQLiteError(
      "mapping_not_found",
      `${label} mapping was not found.`,
    );
  }

  private conflict(label: string): ConversationPlatformSQLiteError {
    return new ConversationPlatformSQLiteError(
      "conflicting_binding",
      `${label} binding differs from the existing value.`,
    );
  }
}
