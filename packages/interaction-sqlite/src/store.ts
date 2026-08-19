import { DatabaseSync } from "node:sqlite";

import {
  assertConversationInboundEvent,
  assertConversationParticipationPolicy,
} from "@lervo/conversation-contract";
import type {
  ConversationInboundClaim,
  ConversationInteractionStore,
  ConversationOutboundLease,
  ParticipationWindow,
} from "@lervo/interaction";
import type {
  ConversationDeliveryReceipt,
  ConversationInboundEvent,
  ConversationOutboundMessage,
  ConversationParticipationDecision,
  ConversationParticipationPolicy,
} from "@lervo/schemas";

import {
  configureInteractionDatabase,
  ensureInteractionDatabasePath,
  interactionSQLiteSchemaVersion,
  migrateInteractionDatabase,
} from "./database.js";
import { ConversationDecisionSQLiteRepository } from "./decision-repository.js";
import { InteractionSQLiteError } from "./errors.js";
import { ConversationInboxSQLiteRepository } from "./inbox-repository.js";
import { ConversationOutboxSQLiteRepository } from "./outbox-repository.js";
import { InteractionSQLiteTransactionRunner } from "./transaction.js";

export interface InteractionSQLiteIntegrityReport {
  valid: true;
  inboxCount: number;
  decisionCount: number;
  outboxCount: number;
}

export class SQLiteConversationInteractionStore implements ConversationInteractionStore {
  readonly path: string;
  private closed = false;
  private readonly inbox: ConversationInboxSQLiteRepository;
  private readonly decisions: ConversationDecisionSQLiteRepository;
  private readonly outbox: ConversationOutboxSQLiteRepository;
  private readonly transaction: InteractionSQLiteTransactionRunner;

  private constructor(
    path: string,
    private readonly database: DatabaseSync,
    maxRecords: number,
  ) {
    this.path = path;
    this.inbox = new ConversationInboxSQLiteRepository(database, maxRecords);
    this.decisions = new ConversationDecisionSQLiteRepository(database);
    this.outbox = new ConversationOutboxSQLiteRepository(database);
    this.transaction = new InteractionSQLiteTransactionRunner(database);
  }

  static async open(options: {
    path: string;
    maxRecords?: number;
  }): Promise<SQLiteConversationInteractionStore> {
    const maxRecords = options.maxRecords ?? 100_000;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1_000_000) {
      throw new InteractionSQLiteError("integrity_failed", "Interaction maxRecords가 유효하지 않습니다.");
    }
    const path = await ensureInteractionDatabasePath(options.path);
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configureInteractionDatabase(database);
      migrateInteractionDatabase(database);
      const store = new SQLiteConversationInteractionStore(path, database, maxRecords);
      store.checkIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new InteractionSQLiteError("closed", "닫힌 Interaction SQLite store입니다.");
  }

  async claimInbound(input: {
    event: ConversationInboundEvent;
    policy: ConversationParticipationPolicy;
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<ConversationInboundClaim> {
    this.assertOpen();
    assertConversationInboundEvent(input.event);
    assertConversationParticipationPolicy(input.policy);
    if (
      input.policy.projectId !== input.event.target.projectId ||
      !input.policy.conversationIds.includes(input.event.target.conversationId)
    ) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "Conversation event와 participation policy 범위가 다릅니다.",
      );
    }
    return this.transaction.write(() => {
      const claim = this.inbox.claim({
        event: input.event,
        policyId: input.policy.policyId,
        roleId: input.policy.roleId,
        workerId: input.workerId,
        claimedAt: input.claimedAt,
        leaseDurationMs: input.leaseDurationMs,
      });
      if (claim.status !== "completed") return claim;
      const decision = this.decisions.read(input.event, input.policy.roleId);
      if (decision === null) {
        throw new InteractionSQLiteError("integrity_failed", "완료된 inbox에 decision이 없습니다.");
      }
      const outbound = this.outbox.readForSource(input.event, input.policy.roleId);
      if ((decision.action === "respond") !== (outbound !== null)) {
        throw new InteractionSQLiteError("integrity_failed", "Decision과 outbox 관계가 다릅니다.");
      }
      return { status: "completed", decision, outbound };
    });
  }

  async getParticipationWindow(input: {
    policyId: string;
    conversationId: string;
    at: string;
  }): Promise<ParticipationWindow> {
    this.assertOpen();
    return this.decisions.window(input);
  }

  async completeInbound(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    decision: ConversationParticipationDecision;
    outbound: ConversationOutboundMessage | null;
  }): Promise<void> {
    this.assertOpen();
    this.transaction.write(() => {
      const event = this.inbox.leasedEvent(input);
      if ((input.decision.action === "respond") !== (input.outbound !== null)) {
        throw new InteractionSQLiteError("integrity_failed", "Participation action과 outbound 유무가 다릅니다.");
      }
      this.decisions.insert({
        event,
        policyId: input.policyId,
        roleId: input.roleId,
        value: input.decision,
      });
      if (input.outbound !== null) {
        this.outbox.enqueue({
          event,
          policyId: input.policyId,
          roleId: input.roleId,
          message: input.outbound,
        });
      }
      this.inbox.complete(input);
    });
  }

  async rescheduleInbound(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    failedAt: string;
    availableAt: string;
    failureCode: string;
  }): Promise<void> {
    this.assertOpen();
    this.transaction.write(() => this.inbox.reschedule(input));
  }

  async claimOutbound(input: {
    integrationId: string;
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<ConversationOutboundLease[]> {
    this.assertOpen();
    return this.transaction.write(() => this.outbox.claim(input));
  }

  async acknowledgeOutbound(input: {
    outboundId: string;
    leaseId: string;
    receipt: ConversationDeliveryReceipt;
  }): Promise<void> {
    this.assertOpen();
    this.transaction.write(() => this.outbox.acknowledge(input));
  }

  async rescheduleOutbound(input: {
    outboundId: string;
    leaseId: string;
    failedAt: string;
    availableAt: string;
    failureCode: string;
  }): Promise<void> {
    this.assertOpen();
    this.transaction.write(() => this.outbox.reschedule(input));
  }

  checkIntegrity(): InteractionSQLiteIntegrityReport {
    this.assertOpen();
    if (this.database.prepare("PRAGMA quick_check;").get()?.quick_check !== "ok") {
      throw new InteractionSQLiteError("integrity_failed", "Interaction SQLite quick_check가 실패했습니다.");
    }
    const version = this.database.prepare(
      "SELECT value FROM interaction_meta WHERE key = 'storage_schema_version'",
    ).get()?.value;
    if (version !== String(interactionSQLiteSchemaVersion)) {
      throw new InteractionSQLiteError("integrity_failed", "Interaction SQLite metadata가 유효하지 않습니다.");
    }
    const requiredTriggers = new Set([
      "conversation_inbox_identity_immutable",
      "conversation_inbox_lifecycle_guard",
      "conversation_inbox_no_delete",
      "conversation_decisions_immutable",
      "conversation_decisions_no_delete",
      "conversation_outbox_identity_immutable",
      "conversation_outbox_lifecycle_guard",
      "conversation_outbox_no_delete",
    ]);
    for (const row of this.database.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'trigger'",
    ).all()) {
      if (typeof row.name === "string") requiredTriggers.delete(row.name);
    }
    if (requiredTriggers.size !== 0) {
      throw new InteractionSQLiteError("integrity_failed", "Interaction append-only trigger가 누락되었습니다.");
    }
    return this.counts();
  }

  auditIntegrity(): InteractionSQLiteIntegrityReport {
    this.assertOpen();
    this.checkIntegrity();
    if (this.database.prepare("PRAGMA foreign_key_check;").all().length !== 0) {
      throw new InteractionSQLiteError("integrity_failed", "Interaction foreign key가 손상되었습니다.");
    }
    const inbox = this.inbox.auditAll();
    this.decisions.auditAll();
    this.outbox.auditAll();
    for (const coordinate of inbox) {
      const decision = this.decisions.read(coordinate.event, coordinate.roleId);
      const outbound = this.outbox.readForSource(coordinate.event, coordinate.roleId);
      if (
        (coordinate.status === "completed") !== (decision !== null) ||
        (decision?.action === "respond") !== (outbound !== null)
      ) {
        throw new InteractionSQLiteError("integrity_failed", "Interaction 완료 원본 관계가 다릅니다.");
      }
    }
    return this.counts();
  }

  private counts(): InteractionSQLiteIntegrityReport {
    const count = (table: string): number => {
      const value = this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count;
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw new InteractionSQLiteError("integrity_failed", "Interaction row count가 유효하지 않습니다.");
      }
      return value;
    };
    return {
      valid: true,
      inboxCount: count("conversation_inbox"),
      decisionCount: count("conversation_participation_decisions"),
      outboxCount: count("conversation_outbox"),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}
