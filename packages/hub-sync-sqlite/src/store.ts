import { DatabaseSync } from "node:sqlite";

import {
  type HubCommandArtifactLifecycleRepository,
  type HubCommandArtifactCleanupScheduleStore,
  type HubCommandArtifactCleanupCycleClaimInput,
  type HubCommandArtifactCleanupCycleCompletion,
  type HubCommandArtifactCleanupCycleFailure,
  type HubCommandArtifactCleanupScheduleClaim,
  type HubCommandArtifactPurgeClaim,
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
  type HubWorkstreamReplicationStore,
  type HubWorkspaceCoordinationStore,
  type HubWorkspaceReservation,
  type HubWorkspaceReservationDecision,
  type HubWorkspaceReservationRelease,
  type HubWorkspaceReservationRenewal,
  type HubWorkspaceReservationRequest,
  type HubWorkspaceSummary,
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
  type WorkstreamReplicationPublishRequest,
  type WorkstreamReplicationPublishResponse,
  type WorkstreamReplicationReadResponse,
} from "@lervo/schemas";

import { ensureDatabasePath } from "./database-lifecycle.js";
import { HubAuditSQLiteRepository } from "./audit-repository.js";
import { HubCommandAuthorshipSQLiteRepository } from "./command-authorship-repository.js";
import { auditCommandArtifactLifecycle } from "./command-artifact-lifecycle-audit.js";
import { HubCommandArtifactLifecycleSQLiteRepository } from "./command-artifact-lifecycle-repository.js";
import { HubCommandArtifactCleanupRuntimeSQLiteRepository } from "./command-artifact-cleanup-runtime-repository.js";
import { auditCommandArtifactCleanupRuntime } from "./command-artifact-cleanup-runtime-audit.js";
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
import { HubWorkstreamSQLiteRepository } from "./workstream-repository.js";
import { HubWorkspaceCoordinationSQLiteRepository } from "./workspace-coordination-repository.js";

export class HubSyncSQLiteStore
  implements
    HubSyncCommandStore,
    HubSyncIntegrityStore,
    HubSyncLifecycle,
    HubWorkstreamReplicationStore,
    HubWorkspaceCoordinationStore,
    HubRemoteCommandQueueStore,
    HubRemoteCommandQueueInspectionStore,
    HubTraceSource,
    HubPolicySourceStore,
    HubCommandAuthoringStore,
    HubCommandArtifactLifecycleRepository,
    HubCommandArtifactCleanupScheduleStore
{
  readonly path: string;
  private closed = false;
  private readonly auditRepository: HubAuditSQLiteRepository;
  private readonly commandAuthorshipRepository: HubCommandAuthorshipSQLiteRepository;
  private readonly commandArtifactLifecycleRepository: HubCommandArtifactLifecycleSQLiteRepository;
  private readonly commandArtifactCleanupRuntimeRepository: HubCommandArtifactCleanupRuntimeSQLiteRepository;
  private readonly eventInboxRepository: HubEventInboxSQLiteRepository;
  private readonly registrationRepository: HubRegistrationSQLiteRepository;
  private readonly remoteCommandRepository: HubRemoteCommandSQLiteRepository;
  private readonly policyRepository: HubPolicySQLiteRepository;
  private readonly traceRepository: HubTraceSQLiteRepository;
  private readonly knowledgeGraphIndex: KnowledgeGraphIndexSQLiteWriter;
  private readonly knowledgeGraphRepository: HubKnowledgeGraphSQLiteRepository;
  private readonly transactionRunner: SQLiteTransactionRunner;
  private readonly workstreamRepository: HubWorkstreamSQLiteRepository;
  private readonly workspaceCoordinationRepository: HubWorkspaceCoordinationSQLiteRepository;

  private constructor(
    path: string,
    private readonly database: DatabaseSync,
  ) {
    this.path = path;
    this.auditRepository = new HubAuditSQLiteRepository(database);
    this.commandAuthorshipRepository = new HubCommandAuthorshipSQLiteRepository(database);
    this.commandArtifactLifecycleRepository = new HubCommandArtifactLifecycleSQLiteRepository(
      database,
    );
    this.commandArtifactCleanupRuntimeRepository =
      new HubCommandArtifactCleanupRuntimeSQLiteRepository(database);
    this.eventInboxRepository = new HubEventInboxSQLiteRepository(database);
    this.registrationRepository = new HubRegistrationSQLiteRepository(database);
    this.remoteCommandRepository = new HubRemoteCommandSQLiteRepository(database);
    this.policyRepository = new HubPolicySQLiteRepository(database);
    this.traceRepository = new HubTraceSQLiteRepository(database);
    this.knowledgeGraphIndex = new KnowledgeGraphIndexSQLiteWriter(database);
    this.knowledgeGraphRepository = new HubKnowledgeGraphSQLiteRepository(database);
    this.transactionRunner = new SQLiteTransactionRunner(database);
    this.workstreamRepository = new HubWorkstreamSQLiteRepository(database);
    this.workspaceCoordinationRepository = new HubWorkspaceCoordinationSQLiteRepository(database);
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
      throw new HubSyncStoreError("closed", "A closed Hub sync SQLite store cannot be used.");
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

  async publishWorkstream(input: {
    destinationId: string;
    request: WorkstreamReplicationPublishRequest;
    publishedAt: string;
  }): Promise<WorkstreamReplicationPublishResponse> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.workstreamRepository.publish(input));
  }

  async readWorkstream(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
  }): Promise<WorkstreamReplicationReadResponse> {
    this.assertOpen();
    return this.transactionRunner.read(() => this.workstreamRepository.read(input));
  }

  async reserveWorkspace(input: {
    destinationId: string;
    request: HubWorkspaceReservationRequest;
    acceptedAt: string;
  }): Promise<HubWorkspaceReservationDecision> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.workspaceCoordinationRepository.reserve(input));
  }

  async renewWorkspaceReservation(input: {
    destinationId: string;
    request: HubWorkspaceReservationRenewal;
    acceptedAt: string;
  }): Promise<HubWorkspaceReservation> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.workspaceCoordinationRepository.renew(input));
  }

  async releaseWorkspaceReservation(input: {
    destinationId: string;
    request: HubWorkspaceReservationRelease;
    acceptedAt: string;
  }): Promise<HubWorkspaceReservation> {
    this.assertOpen();
    return this.transactionRunner.write(() => this.workspaceCoordinationRepository.release(input));
  }

  async publishWorkspaceSummary(input: {
    destinationId: string;
    summary: HubWorkspaceSummary;
    acceptedAt: string;
  }): Promise<{ status: "created" | "updated" | "duplicate"; summary: HubWorkspaceSummary }> {
    this.assertOpen();
    return this.transactionRunner.write(() =>
      this.workspaceCoordinationRepository.publishSummary(input),
    );
  }

  async listWorkspaceSummaries(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    acceptedAt: string;
  }): Promise<HubWorkspaceSummary[]> {
    this.assertOpen();
    return this.transactionRunner.write(() =>
      this.workspaceCoordinationRepository.listSummaries(input),
    );
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
      this.commandAuthorshipRepository.findLeasedArtifact(input),
    );
  }

  async claimExpiredArtifacts(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<HubCommandArtifactPurgeClaim[]> {
    this.assertOpen();
    return this.transactionRunner.write(() =>
      this.commandArtifactLifecycleRepository.claimExpired(input),
    );
  }

  async claimOrphanArtifact(input: {
    workerId: string;
    artifactUri: string;
    observedModifiedAt: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<HubCommandArtifactPurgeClaim | null> {
    this.assertOpen();
    return this.transactionRunner.write(() =>
      this.commandArtifactLifecycleRepository.claimOrphan(input),
    );
  }

  async completeArtifactPurge(input: {
    claimId: string;
    workerId: string;
    completedAt: string;
  }): Promise<{
    status: "completed" | "partial" | "duplicate";
    kind: "expired" | "orphan";
    purgedDeliveryCount: number;
    continuationRecommended: boolean;
  }> {
    this.assertOpen();
    return this.transactionRunner.write(() =>
      this.commandArtifactLifecycleRepository.complete(input),
    );
  }

  async releaseArtifactPurgeClaim(input: {
    claimId: string;
    workerId: string;
    releasedAt: string;
  }): Promise<void> {
    this.assertOpen();
    this.transactionRunner.write(() => this.commandArtifactLifecycleRepository.release(input));
  }

  async claimArtifactCleanupCycle(
    input: HubCommandArtifactCleanupCycleClaimInput,
  ): Promise<HubCommandArtifactCleanupScheduleClaim> {
    this.assertOpen();
    return this.transactionRunner.write(() =>
      this.commandArtifactCleanupRuntimeRepository.claim(input),
    );
  }

  async completeArtifactCleanupCycle(
    input: HubCommandArtifactCleanupCycleCompletion,
  ): Promise<void> {
    this.assertOpen();
    this.transactionRunner.write(() =>
      this.commandArtifactCleanupRuntimeRepository.complete(input),
    );
  }

  async failArtifactCleanupCycle(input: HubCommandArtifactCleanupCycleFailure): Promise<void> {
    this.assertOpen();
    this.transactionRunner.write(() => this.commandArtifactCleanupRuntimeRepository.fail(input));
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
      this.policyRepository.currentSnapshot(input.destinationId, input.target),
    );
  }

  async getPolicyCommand(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    commandId: string;
  }): Promise<HubPolicyCommandBinding | null> {
    this.assertOpen();
    return this.transactionRunner.read(() =>
      this.policyRepository.command(input.destinationId, input.target, input.commandId),
    );
  }

  async getPolicyApproval(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    approvalId: string;
  }): Promise<SignedPolicyApproval | null> {
    this.assertOpen();
    return this.transactionRunner.read(() =>
      this.policyRepository.approval(input.destinationId, input.target, input.approvalId),
    );
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
    auditCommandArtifactCleanupRuntime(this.database);
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
          "The Hub sync SQLite project index differs from the source.",
        );
      }
      eventCount += state.events.length;
      this.knowledgeGraphIndex.assertMatchesEvents(coordinate, state.events);
    }
    this.remoteCommandRepository.auditAll();
    this.commandAuthorshipRepository.auditAll();
    auditCommandArtifactLifecycle(this.database);
    auditCommandArtifactCleanupRuntime(this.database);
    this.policyRepository.auditAll();
    try {
      this.workstreamRepository.auditAll();
    } catch (error) {
      throw new HubSyncStoreError("integrity_failed", "The Hub workstream revision audit failed.", {
        cause: error,
      });
    }
    this.auditRepository.assertGlobalCounts(coordinates.length, eventCount);
    return { valid: true, projectCount: coordinates.length, eventCount };
  }

  private verifyDatabaseStructure(): void {
    if (this.database.prepare("PRAGMA foreign_keys;").get()?.foreign_keys !== 1) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "Hub sync SQLite foreign-key enforcement is disabled.",
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
      "hub_remote_command_artifact_retentions_no_update",
      "hub_remote_command_artifact_retentions_no_delete",
      "hub_remote_command_artifact_purges_no_update",
      "hub_remote_command_artifact_purges_no_delete",
      "hub_remote_command_artifact_gc_completions_no_update",
      "hub_remote_command_artifact_gc_completions_no_delete",
      "hub_remote_command_artifact_cleanup_runtime_no_delete",
      "hub_policy_snapshots_no_update",
      "hub_policy_snapshots_no_delete",
      "hub_policy_approvals_no_update",
      "hub_policy_approvals_no_delete",
      "hub_policy_revocations_no_update",
      "hub_policy_revocations_no_delete",
      "hub_workstream_revisions_identity_immutable",
      "hub_workstream_revisions_no_delete",
    ]);
    for (const row of this.database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger'")
      .all()) {
      if (typeof row.name === "string") requiredTriggers.delete(row.name);
    }
    if (requiredTriggers.size !== 0) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "A Hub sync SQLite append-only trigger is missing.",
      );
    }
  }

  private verifyFullDatabaseIntegrity(): void {
    if (this.database.prepare("PRAGMA quick_check;").get()?.quick_check !== "ok") {
      throw new HubSyncStoreError("integrity_failed", "The Hub sync SQLite quick_check failed.");
    }
    if (this.database.prepare("PRAGMA foreign_key_check;").get() !== undefined) {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The Hub sync SQLite foreign-key check failed.",
      );
    }
  }

  async journalMode(): Promise<string> {
    this.assertOpen();
    const mode = this.database.prepare("PRAGMA journal_mode;").get()?.journal_mode;
    if (typeof mode !== "string") {
      throw new HubSyncStoreError(
        "integrity_failed",
        "The Hub sync SQLite journal mode cannot be read.",
      );
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
