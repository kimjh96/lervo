import { DatabaseSync } from "node:sqlite";

import {
  type HubCommandAuthoringStore,
  type HubCommandAuthorshipRecord,
} from "@lervo/hub-command";
import {
  type HubPolicyBundle,
  type HubPolicyCommandBinding,
  type HubPolicyPublishResult,
  type HubPolicySourceStore,
} from "@lervo/hub-policy";
import {
  type HubSyncCommandStore,
  type HubSyncIntegrityReport,
  type HubSyncIntegrityStore,
  type HubSyncLifecycle,
  type HubRemoteCommandDeliveryState,
  type HubRemoteCommandEnqueueResult,
  type HubRemoteCommandQueueInspectionStore,
  type HubRemoteCommandQueueStore,
} from "@lervo/hub-sync";
import {
  type HubProjectKnowledgeGraph,
  type HubProjectTrace,
  type HubProjectTraceSummary,
  type HubRunTrace,
  type HubTracePage,
  type HubTraceSource,
  type ResolvedHubProjectRunQuery,
  type ResolvedHubProjectTraceQuery,
  type ResolvedHubKnowledgeGraphQuery,
  type ResolvedHubRunEventQuery,
} from "@lervo/hub-trace";
import {
  type EventSyncAcknowledgement,
  type OutboundEventBatch,
  type ProjectRegistrationRequest,
  type ProjectRegistrationResponse,
  type RemoteCommandDeliveryAcknowledgement,
  type RemoteCommandDeliveryConfirmation,
  type RemoteCommandLease,
  type RemoteCommandPayloadReference,
  type RemoteCommandTarget,
  type SignedRemoteCommand,
  type SignedPolicyApproval,
  type SignedPolicyApprovalRevocation,
  type SignedPolicySnapshot,
} from "@lervo/schemas";

import { ensureDatabasePath } from "./database-lifecycle.js";
import { HubAuditSQLiteRepository } from "./audit-repository.js";
import { HubCommandAuthorshipSQLiteRepository } from "./command-authorship-repository.js";
import { HubEventInboxSQLiteRepository } from "./event-inbox-repository.js";
import { HubSyncStoreError } from "./errors.js";
import { configureDatabase, migrateDatabase } from "./migrations.js";
import { HubRegistrationSQLiteRepository } from "./registration-repository.js";
import { HubPolicySQLiteRepository } from "./policy-repository.js";
import { HubRemoteCommandSQLiteRepository } from "./remote-command-repository.js";
import { HubTraceSQLiteRepository } from "./trace-repository.js";
import { KnowledgeGraphIndexSQLiteWriter } from "./knowledge-graph-index-writer.js";
import { HubKnowledgeGraphSQLiteRepository } from "./knowledge-graph-repository.js";
import { SQLiteTransactionRunner } from "./transaction-runner.js";

export class HubSyncSQLiteStore implements
  HubSyncCommandStore,
  HubSyncIntegrityStore,
  HubSyncLifecycle,
  HubRemoteCommandQueueStore,
  HubRemoteCommandQueueInspectionStore,
  HubTraceSource,
  HubPolicySourceStore,
  HubCommandAuthoringStore
{
  readonly path: string;
  private closed = false;
  private readonly auditRepository: HubAuditSQLiteRepository;
  private readonly commandAuthorshipRepository: HubCommandAuthorshipSQLiteRepository;
  private readonly eventInboxRepository: HubEventInboxSQLiteRepository;
  private readonly registrationRepository: HubRegistrationSQLiteRepository;
  private readonly remoteCommandRepository: HubRemoteCommandSQLiteRepository;
  private readonly policyRepository: HubPolicySQLiteRepository;
  private readonly traceRepository: HubTraceSQLiteRepository;
  private readonly knowledgeGraphIndex: KnowledgeGraphIndexSQLiteWriter;
  private readonly knowledgeGraphRepository: HubKnowledgeGraphSQLiteRepository;
  private readonly transactionRunner: SQLiteTransactionRunner;

  private constructor(path: string, private readonly database: DatabaseSync) {
    this.path = path;
    this.auditRepository = new HubAuditSQLiteRepository(database);
    this.commandAuthorshipRepository = new HubCommandAuthorshipSQLiteRepository(database);
    this.eventInboxRepository = new HubEventInboxSQLiteRepository(database);
    this.registrationRepository = new HubRegistrationSQLiteRepository(database);
    this.remoteCommandRepository = new HubRemoteCommandSQLiteRepository(database);
    this.policyRepository = new HubPolicySQLiteRepository(database);
    this.traceRepository = new HubTraceSQLiteRepository(database);
    this.knowledgeGraphIndex = new KnowledgeGraphIndexSQLiteWriter(database);
    this.knowledgeGraphRepository = new HubKnowledgeGraphSQLiteRepository(database);
    this.transactionRunner = new SQLiteTransactionRunner(database);
  }

  static async open(options: { path: string }): Promise<HubSyncSQLiteStore> {
    const path = await ensureDatabasePath(options.path);
    const database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configureDatabase(database);
      migrateDatabase(database);
      new KnowledgeGraphIndexSQLiteWriter(database).rebuildIfRequired();
      const store = new HubSyncSQLiteStore(path, database);
      await store.checkIntegrity();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new HubSyncStoreError("closed", "닫힌 Hub sync SQLite store는 사용할 수 없습니다.");
    }
  }

  async registerProject(input: {
    request: ProjectRegistrationRequest;
    acceptedAt: string;
  }): Promise<ProjectRegistrationResponse> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.registrationRepository.register(input));
  }

  async acceptEventBatch(input: {
    batch: OutboundEventBatch;
    acknowledgedAt: string;
  }): Promise<EventSyncAcknowledgement> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.eventInboxRepository.accept(input));
  }

  async enqueueRemoteCommand(input: {
    destinationId: string;
    envelope: SignedRemoteCommand;
    queuedAt: string;
  }): Promise<HubRemoteCommandEnqueueResult> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.remoteCommandRepository.enqueue(input));
  }

  async findAuthorship(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    idempotencyKey: string;
  }): Promise<HubCommandAuthorshipRecord | null> {
    this.assertOpen();
    return this.transactionRunner.read(() => this.commandAuthorshipRepository.find(input));
  }

  async commitAuthorship(input: HubCommandAuthorshipRecord): Promise<{
    status: "created" | "duplicate";
    record: HubCommandAuthorshipRecord;
  }> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.commandAuthorshipRepository.commit(input));
  }

  async findLeasedArtifact(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    nodeId: string;
    artifactId: string;
    requestedAt: string;
  }): Promise<{
    uri: string;
    reference: RemoteCommandPayloadReference;
  } | null> {
    this.assertOpen();
    return this.transactionRunner.read(() =>
      this.commandAuthorshipRepository.findLeasedArtifact(input));
  }

  async leaseRemoteCommands(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    leasedTo: string;
    leasedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<RemoteCommandLease[]> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.remoteCommandRepository.lease(input));
  }

  async acknowledgeRemoteCommand(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    leasedTo: string;
    acknowledgement: RemoteCommandDeliveryAcknowledgement;
    confirmedAt: string;
  }): Promise<RemoteCommandDeliveryConfirmation> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.remoteCommandRepository.acknowledge(input));
  }

  async getRemoteCommandDelivery(
    deliveryId: string,
  ): Promise<HubRemoteCommandDeliveryState | null> {
    this.assertOpen();
    return this.transactionRunner.read(() => this.remoteCommandRepository.get(deliveryId));
  }

  async getCurrentPolicySnapshot(input: {
    destinationId: string;
    target: RemoteCommandTarget;
  }): Promise<SignedPolicySnapshot | null> {
    this.assertOpen();
    return this.transactionRunner.read(() =>
      this.policyRepository.currentSnapshot(input.destinationId, input.target));
  }

  async getPolicyCommand(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    commandId: string;
  }): Promise<HubPolicyCommandBinding | null> {
    this.assertOpen();
    return this.transactionRunner.read(() =>
      this.policyRepository.command(input.destinationId, input.target, input.commandId));
  }

  async getPolicyApproval(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    approvalId: string;
  }): Promise<SignedPolicyApproval | null> {
    this.assertOpen();
    return this.transactionRunner.read(() =>
      this.policyRepository.approval(input.destinationId, input.target, input.approvalId));
  }

  async publishPolicySnapshot(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    envelope: SignedPolicySnapshot;
    publishedAt: string;
  }): Promise<HubPolicyPublishResult> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.policyRepository.publishSnapshot(input));
  }

  async publishPolicyApproval(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    envelope: SignedPolicyApproval;
    publishedAt: string;
  }): Promise<HubPolicyPublishResult> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.policyRepository.publishApproval(input));
  }

  async publishPolicyRevocation(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    envelope: SignedPolicyApprovalRevocation;
    publishedAt: string;
  }): Promise<HubPolicyPublishResult> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.policyRepository.publishRevocation(input));
  }

  async pullPolicyBundle(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    currentSnapshotId: string | null;
  }): Promise<HubPolicyBundle | null> {
    this.assertOpen();
    return this.transactionRunner.read(() => this.policyRepository.pullBundle(input));
  }

  async listProjects(
    query: ResolvedHubProjectTraceQuery,
  ): Promise<HubTracePage<HubProjectTraceSummary, { destinationId: string; projectId: string }>> {
    this.assertOpen();
    return this.transactionRunner.read(() => this.traceRepository.listProjects(query));
  }

  async getProject(query: ResolvedHubProjectRunQuery): Promise<HubProjectTrace | null> {
    this.assertOpen();
    return this.transactionRunner.read(() => this.traceRepository.getProject(query));
  }

  async getRun(query: ResolvedHubRunEventQuery): Promise<HubRunTrace | null> {
    this.assertOpen();
    return this.transactionRunner.read(() => this.traceRepository.getRun(query));
  }

  async getKnowledgeGraph(
    query: ResolvedHubKnowledgeGraphQuery,
  ): Promise<HubProjectKnowledgeGraph | null> {
    this.assertOpen();
    return this.transactionRunner.read(() => {
      const project = this.traceRepository.getProjectSummary(
        query.scope,
        query.destinationId,
        query.projectId,
      );
      return project === null ? null : this.knowledgeGraphRepository.get(query, project);
    });
  }

  async checkIntegrity(): Promise<HubSyncIntegrityReport> {
    this.assertOpen();
    this.verifyDatabaseStructure();
    const counts = this.auditRepository.healthCounts();
    return { valid: true, ...counts };
  }

  async auditIntegrity(): Promise<HubSyncIntegrityReport> {
    this.assertOpen();
    this.verifyDatabaseStructure();
    this.verifyFullDatabaseIntegrity();
    const coordinates = this.auditRepository.listProjectCoordinates();
    let eventCount = 0;
    for (const coordinate of coordinates) {
      const state = this.auditRepository.loadProject(coordinate);
      if (state === null) {
        throw new HubSyncStoreError(
          "integrity_failed",
          "Hub sync SQLite project index와 원본이 다릅니다.",
        );
      }
      eventCount += state.events.length;
      this.knowledgeGraphIndex.assertMatchesEvents(coordinate, state.events);
    }
    this.remoteCommandRepository.auditAll();
    this.commandAuthorshipRepository.auditAll();
    this.policyRepository.auditAll();
    this.auditRepository.assertGlobalCounts(coordinates.length, eventCount);
    return { valid: true, projectCount: coordinates.length, eventCount };
  }

  private verifyDatabaseStructure(): void {
    if (this.database.prepare("PRAGMA foreign_keys;").get()?.foreign_keys !== 1) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "Hub sync SQLite foreign key 강제가 비활성 상태입니다.",
      );
    }
    const requiredTriggers = new Set([
      "hub_events_no_update",
      "hub_events_no_delete",
      "hub_projects_no_delete",
      "hub_remote_commands_no_delete",
      "hub_remote_commands_identity_immutable",
      "hub_remote_command_authorships_no_update",
      "hub_remote_command_authorships_no_delete",
      "hub_policy_snapshots_no_update",
      "hub_policy_snapshots_no_delete",
      "hub_policy_approvals_no_update",
      "hub_policy_approvals_no_delete",
      "hub_policy_revocations_no_update",
      "hub_policy_revocations_no_delete",
    ]);
    for (const row of this.database.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'trigger'",
    ).all()) {
      if (typeof row.name === "string") requiredTriggers.delete(row.name);
    }
    if (requiredTriggers.size !== 0) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "Hub sync SQLite append-only trigger가 누락되었습니다.",
      );
    }
  }

  private verifyFullDatabaseIntegrity(): void {
    if (this.database.prepare("PRAGMA quick_check;").get()?.quick_check !== "ok") {
      throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite quick_check가 실패했습니다.");
    }
    if (this.database.prepare("PRAGMA foreign_key_check;").get() !== undefined) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "Hub sync SQLite foreign key 검사가 실패했습니다.",
      );
    }
  }

  async journalMode(): Promise<string> {
    this.assertOpen();
    const mode = this.database.prepare("PRAGMA journal_mode;").get()?.journal_mode;
    if (typeof mode !== "string") {
      throw new HubSyncStoreError("integrity_failed", "Hub sync SQLite journal mode를 읽을 수 없습니다.");
    }
    return mode;
  }

  async close(): Promise<void> {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
