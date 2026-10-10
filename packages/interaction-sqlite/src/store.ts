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
  migrateInteractionDatabase,
} from "./database.js";
import { inbound } from "./codec.js";
import { ConversationDecisionSQLiteRepository } from "./decision-repository.js";
import { InteractionSQLiteError } from "./errors.js";
import { ConversationInboxSQLiteRepository } from "./inbox-repository.js";
import {
  ConversationInteractionSQLiteIntegrity,
  type InteractionSQLiteIntegrityReport,
} from "./interaction-integrity.js";
import { ConversationOutboxSQLiteRepository } from "./outbox-repository.js";
import { InteractionSQLiteTransactionRunner } from "./transaction.js";
import { iterateSqliteRows, sqliteRow } from "./sqlite-row.js";

export type { InteractionSQLiteIntegrityReport } from "./interaction-integrity.js";

export class SQLiteConversationInteractionStore implements ConversationInteractionStore {
  readonly path: string;
  private closed = false;
  private readonly inbox: ConversationInboxSQLiteRepository;
  private readonly decisions: ConversationDecisionSQLiteRepository;
  private readonly outbox: ConversationOutboxSQLiteRepository;
  private readonly integrity: ConversationInteractionSQLiteIntegrity;
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
    this.integrity = new ConversationInteractionSQLiteIntegrity(
      database,
      this.inbox,
      this.decisions,
      this.outbox,
    );
    this.transaction = new InteractionSQLiteTransactionRunner(database);
  }

  static async open(options: {
    path: string;
    maxRecords?: number;
  }): Promise<SQLiteConversationInteractionStore> {
    const maxRecords = options.maxRecords ?? 100_000;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 1_000_000) {
      throw new InteractionSQLiteError("integrity_failed", "Interaction maxRecords is invalid.");
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
    if (this.closed)
      throw new InteractionSQLiteError("closed", "The Interaction SQLite store is closed.");
  }

  /** Advisory scheduling only; claiming still validates scope, state, and leases. */
  nextWakeupAt(
    integrationId: string,
    bindings?: readonly { policyId: string; roleId: string }[],
  ): number | null {
    this.assertOpen();
    const inbox = bindings === undefined ? [{}] : bindings;
    const values = inbox.map((binding) => {
      const scoped = "policyId" in binding;
      return sqliteRow(
        this.database
          .prepare(
            `SELECT MIN(CASE WHEN status = 'pending' THEN available_at_ms ELSE lease_expires_at_ms END) AS next_at FROM conversation_inbox WHERE integration_id = ? AND status IN ('pending', 'leased')${scoped ? " AND policy_id = ? AND role_id = ?" : ""}`,
          )
          .get(...(scoped ? [integrationId, binding.policyId, binding.roleId] : [integrationId])),
      )?.next_at;
    });
    values.push(
      sqliteRow(
        this.database
          .prepare(
            "SELECT MIN(CASE WHEN status = 'pending' THEN available_at_ms ELSE lease_expires_at_ms END) AS next_at FROM conversation_outbox WHERE integration_id = ? AND status IN ('pending', 'leased')",
          )
          .get(integrationId),
      )?.next_at,
    );
    const deadlines = values.filter((value): value is number => typeof value === "number");
    return deadlines.length === 0 ? null : Math.min(...deadlines);
  }

  hasInboundSourceEventKeyHash(sourceEventKeyHash: string): boolean {
    this.assertOpen();
    if (!/^sha256:[a-f0-9]{64}$/u.test(sourceEventKeyHash)) {
      throw new InteractionSQLiteError(
        "integrity_failed",
        "The conversation source event key hash is invalid.",
      );
    }
    const pattern = `%"sourceEventKeyHash":"${sourceEventKeyHash}"%`;
    for (const row of iterateSqliteRows(
      this.database.prepare("SELECT * FROM conversation_inbox WHERE event_json LIKE ?"),
      pattern,
    )) {
      if (inbound(row).sourceEventKeyHash === sourceEventKeyHash) return true;
    }
    return false;
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
        "The conversation event and participation policy scopes differ.",
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
        throw new InteractionSQLiteError("integrity_failed", "A completed inbox has no decision.");
      }
      const outbound = this.outbox.readForSource(input.event, input.policy.roleId);
      if ((decision.action === "respond") !== (outbound !== null)) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The decision and outbox relation differs.",
        );
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

  async renewInbound(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    renewedAt: string;
    leaseDurationMs: number;
  }): Promise<void> {
    this.assertOpen();
    this.transaction.write(() => this.inbox.renew(input));
  }

  async completeInbound(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    decision: ConversationParticipationDecision;
    outbound: ConversationOutboundMessage | null;
    terminalFailure?: {
      failureCode: import("@lervo/interaction").ConversationResponseFailureCode;
      failedAt: string;
    };
  }): Promise<void> {
    this.assertOpen();
    this.transaction.write(() => {
      const event = this.inbox.leasedEvent(input);
      if ((input.decision.action === "respond") !== (input.outbound !== null)) {
        throw new InteractionSQLiteError(
          "integrity_failed",
          "The participation action and outbound presence do not agree.",
        );
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

  readyInbound(input: {
    integrationId: string;
    policyId: string;
    roleId: string;
    at: string;
    limit: number;
  }) {
    this.assertOpen();
    return this.inbox.ready(input);
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

  async markOutboundAttentionRequired(input: {
    outboundId: string;
    leaseId: string;
    failedAt: string;
    failureCode: string;
  }): Promise<void> {
    this.assertOpen();
    this.transaction.write(() => this.outbox.markAttentionRequired(input));
  }

  async acknowledgeReconciledOutbound(input: {
    outboundId: string;
    expectedAttemptCount: number;
    expectedFailureCode: string;
    receipt: ConversationDeliveryReceipt;
  }): Promise<void> {
    this.assertOpen();
    this.transaction.write(() => this.outbox.acknowledgeReconciled(input));
  }

  checkIntegrity(): InteractionSQLiteIntegrityReport {
    this.assertOpen();
    return this.integrity.check();
  }

  auditIntegrity(): InteractionSQLiteIntegrityReport {
    this.assertOpen();
    return this.integrity.audit();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }
}
