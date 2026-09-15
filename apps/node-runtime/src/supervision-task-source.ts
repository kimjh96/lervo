import { readCanonicalAssignmentCompletion } from "./supervision-assignment-completion-source.js";
import { SupervisionWorkScopeSource } from "./supervision-work-scope-source.js";
import { readSupervisionHandoffState } from "./supervision-handoff-state.js";
import {
  readCanonicalSupervisionAttention,
  hasPendingSupervisionAttention,
} from "./supervision-attention-source.js";
import { readCanonicalWorkspacePreparation } from "./supervision-workspace-plan.js";
import {
  listAgents,
  listAssignments,
  SupervisionResponsibilityReader,
} from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import type { OutcomeSupervisionSnapshotV1 } from "@lervo/application-contract";
import { observeSupervisionTasks } from "./supervision-task-observation.js";
import { observeSupervisionTaskAdmission } from "./supervision-task-admission.js";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { OwnerControlReadinessV1 } from "@lervo/application-contract";
import { readSupervisionOwnerControl } from "./supervision-owner-control.js";
import { readCanonicalOwnerReasoning } from "./supervision-reasoning-source.js";
import { observeResultDelivery } from "./supervision-result-delivery-observation.js";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import {
  operatingContractHash,
  operatingDecisionId,
  projectManagedAttempts,
  projectWorkstreamResources,
  projectWorkGraphV2,
} from "@lervo/work-controller";
import { SupervisionAuthorityHistory } from "./supervision-authority-history.js";
import {
  supervisionJournalCoordinates,
  observeNodeSupervisionAuthority,
  observeNodeSupervisionRecoveryAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";

/** Reads canonical task and run sources; no inferred start, acceptance, usage, or remote convergence. */
export class SupervisionTaskSource {
  private readonly history: SupervisionAuthorityHistory;
  private readonly binding: NodeSupervisionBinding;
  private readonly workScope: SupervisionWorkScopeSource;

  constructor(
    private readonly storage: ProjectStorage,
    binding: NodeSupervisionBinding,
    private readonly now: () => string,
  ) {
    this.binding = structuredClone(binding);
    this.workScope = new SupervisionWorkScopeSource(storage, this.binding, now);
    this.history = new SupervisionAuthorityHistory(
      storage.events,
      storage.paths.eventDatabase,
      storage.manifest.projectId,
      () => Date.parse(now()),
      "execution",
    );
  }

  async read(excludeDecisionId?: string) {
    if (excludeDecisionId !== undefined && !/^osd_[a-f0-9]{24}$/u.test(excludeDecisionId))
      throw new Error("The admission decision identity is invalid.");
    const workstream = await readCurrentWorkstreamState(this.storage.paths.repositoryRoot);
    if (workstream === null || workstream.snapshot.workstreamId !== this.binding.workstreamId)
      throw new Error("The supervision task workstream changed.");
    const events = await this.history.read();
    const sourceEvent = events.findLast(
      (event) =>
        event.type === "workstream.snapshot.recorded" &&
        event.payload.workstreamId === this.binding.workstreamId &&
        event.payload.revision === workstream.snapshot.revision &&
        event.payload.snapshotContentHash === workstream.contentHash,
    );
    if (sourceEvent === undefined)
      throw new Error("The supervision task source has no canonical workstream event.");
    const agents = await listAgents(this.storage.paths.repositoryRoot);
    const allAssignments = await listAssignments(this.storage.paths.repositoryRoot);
    const workstreamAssignments = allAssignments.filter(
      (item) => item.workstreamId === this.binding.workstreamId,
    );
    if (workstreamAssignments.length > 256)
      throw new Error("The supervised task source exceeds its assignment bound.");
    const workScope = await this.workScope.read(events, workstreamAssignments);
    const assignments = workScope?.assignments ?? workstreamAssignments;
    const scopeAnchor =
      workScope === null
        ? undefined
        : { eventId: workScope.anchor.eventId, eventHash: workScope.anchor.eventHash };
    const coordinates = supervisionJournalCoordinates(
      this.storage,
      this.binding,
      workstream.snapshot.revision,
    );
    const reader = new SupervisionResponsibilityReader(
      this.storage.events,
      this.storage.artifacts,
      coordinates,
      this.now,
    );
    const responsibilities = await Promise.all(
      assignments.map(async (assignment) => ({
        assignmentId: assignment.assignmentId,
        binding: await reader.current(assignment.assignmentId),
      })),
    );
    const execution = projectManagedAttempts({
      events,
      workstreamId: this.binding.workstreamId,
      scopeAnchor,
    });
    const workstreamResources = projectWorkstreamResources({
      events,
      workstreamId: this.binding.workstreamId,
      scopeAnchor,
    });
    const graph = projectWorkGraphV2({
      projectId: this.storage.manifest.projectId,
      workstreamId: this.binding.workstreamId,
      assignments: allAssignments,
      attempts: execution.attempts,
      events,
      observedAt: this.now(),
    });
    const supervisionEvents = events.filter(
      (event) =>
        event.payload.supervisionId === this.binding.supervisionId &&
        event.payload.workstreamId === this.binding.workstreamId &&
        [
          "work.supervision.bound",
          "work.supervision.review.recorded",
          "work.supervision.delivery.queued",
          "work.supervision.delivery.observed",
          "work.supervision.escalation.recorded",
          "work.supervision.handoff.offered",
          "work.supervision.handoff.accepted",
          "work.supervision.peer.observed",
        ].includes(event.type),
    );
    if (
      (await readCurrentWorkstreamState(this.storage.paths.repositoryRoot))?.contentHash !==
        workstream.contentHash ||
      operatingContractHash(await listAssignments(this.storage.paths.repositoryRoot)) !==
        operatingContractHash(allAssignments) ||
      operatingContractHash(await listAgents(this.storage.paths.repositoryRoot)) !==
        operatingContractHash(agents)
    )
      throw new Error("The supervision task sources changed during observation.");
    const executionRuns = new Set(execution.attempts.map((attempt) => attempt.runId));
    for (const runId of workstreamResources.runIds) executionRuns.add(runId);
    const assignmentIds = new Set(assignments.map((assignment) => assignment.assignmentId));
    return {
      workstream: workstream.snapshot,
      workstreamHash: workstream.contentHash,
      sourceEventId: sourceEvent.eventId,
      agents,
      assignments,
      allAssignments,
      workstreamAssignments,
      scopeAnchor,
      responsibilities,
      execution,
      workstreamResources,
      graph,
      supervisionEvents,
      events,
      sourceRevisionDigest: operatingContractHash({
        workstreamHash: workstream.contentHash,
        agents,
        assignments,
        ...(workScope === null ? {} : { workstreamAssignments, scopeAnchor }),
        responsibilities,
        execution,
        graphHash: graph.graphHash,
        // A readiness failure describes a recorded decision's preflight; it changes no task source.
        assignmentEvents: events
          .filter(
            (event) =>
              event.type !== "work.supervision.readiness.failed" &&
              assignmentIds.has(String(event.payload.assignmentId)),
          )
          .map((event) => event.eventHash),
        supervisionEvents: supervisionEvents.map((event) => event.eventHash),
        executionEvents: events
          .filter((event) => executionRuns.has(event.runId))
          .map((event) => event.eventHash),
        decisions: events
          .filter(
            (event) =>
              event.payload.workstreamId === this.binding.workstreamId &&
              [
                "work.supervision.decision.recorded",
                "work.supervision.effect.observed",
                "work.supervision.decision.superseded",
              ].includes(event.type) &&
              event.payload.decisionId !== excludeDecisionId,
          )
          .map((event) => event.eventHash),
      }),
    };
  }

  nextAuditAt() {
    return this.history.nextAuditAt();
  }

  async readOwnerControlReadiness(plan: OperatingActionPlanV1): Promise<OwnerControlReadinessV1> {
    const decisionId = operatingDecisionId(plan);
    const source = await this.read(decisionId);
    const authority = await observeNodeSupervisionAuthority(
      this.storage,
      this.binding,
      this.now,
      this.history,
    );
    const control =
      plan.effectContract === "work.owner_attention.v1"
        ? await readCanonicalSupervisionAttention({
            storage: this.storage,
            source,
            plan,
            binding: this.binding,
            now: this.now,
          })
        : [
              "work.assignment_completion.v1",
              "work.assignment_completion.v2",
              "work.assignment_completion.v3",
            ].includes(plan.effectContract)
          ? await readCanonicalAssignmentCompletion({
              storage: this.storage,
              source,
              plan,
              binding: this.binding,
              now: this.now,
            })
          : plan.effectContract === "work.workspace_preparation.v1"
            ? await readCanonicalWorkspacePreparation({
                storage: this.storage,
                source,
                plan,
                now: this.now,
              })
            : plan.effectContract === "work.owner_reasoning.v1"
              ? await readCanonicalOwnerReasoning({
                  source,
                  plan,
                  binding: this.binding,
                  storage: this.storage,
                  now: this.now,
                })
              : await readSupervisionOwnerControl({
                  source,
                  plan,
                  binding: this.binding,
                  events: this.storage.events,
                  artifacts: this.storage.artifacts,
                });
    if (
      authority.source.workstreamRevision !== source.workstream.revision ||
      (await this.read(decisionId)).sourceRevisionDigest !== source.sourceRevisionDigest
    )
      throw new Error("The owner control source changed during observation.");
    const observedAt = this.now();
    return {
      schemaVersion: 1,
      kind: "work.owner_control.readiness",
      planHash: operatingContractHash(plan),
      sourceRevisionDigest: source.sourceRevisionDigest,
      ownerAgentId: this.binding.ownerAgentId,
      effectContract: control.fields.effectContract,
      observedAt,
      validUntil: new Date(
        Math.min(
          Date.parse(observedAt) + 5000,
          Date.parse(plan.deadline),
          Date.parse(authority.installation.mandate.expiresAt),
        ),
      ).toISOString(),
      status: "ready",
      reasonCodes: [],
    };
  }

  async readAdmission(plan: OperatingActionPlanV1) {
    const decisionId = operatingDecisionId(plan);
    const source = await this.read(decisionId);
    const authority = await observeNodeSupervisionAuthority(
      this.storage,
      this.binding,
      this.now,
      this.history,
    );
    const observation = await observeSupervisionTaskAdmission({
      storage: this.storage,
      repositoryRoot: this.storage.paths.repositoryRoot,
      source,
      authority,
      plan,
      artifacts: this.storage.artifacts,
      events: this.storage.events,
      binding: this.binding,
      now: this.now(),
    });
    if ((await this.read(decisionId)).sourceRevisionDigest !== source.sourceRevisionDigest)
      throw new Error("The supervision admission changed during observation.");
    return observation;
  }

  async readSnapshot(excludeDecisionId?: string): Promise<OutcomeSupervisionSnapshotV1> {
    const source = await this.read(excludeDecisionId);
    const authority = await observeNodeSupervisionRecoveryAuthority(
      this.storage,
      this.binding,
      this.now,
      this.history,
    );
    const tasks = await observeSupervisionTasks(
      source,
      this.storage.artifacts,
      this.binding,
      this.storage.events,
    );
    if (
      authority.source.workstreamRevision !== source.workstream.revision ||
      (await this.read(excludeDecisionId)).sourceRevisionDigest !== source.sourceRevisionDigest
    )
      throw new Error("The supervision observation changed while reading result evidence.");
    const decisions = new Map<string, string>();
    for (const event of source.events) {
      if (event.payload.supervisionId !== this.binding.supervisionId) continue;
      if (event.type === "work.supervision.decision.recorded")
        decisions.set(String(event.payload.decisionId), "recorded");
      if (event.type === "work.supervision.effect.observed")
        decisions.set(String(event.payload.decisionId), String(event.payload.status));
      if (event.type === "work.supervision.decision.superseded")
        decisions.set(String(event.payload.decisionId), "superseded");
    }
    return {
      schemaVersion: 1,
      ...this.binding,
      projectId: this.storage.manifest.projectId,
      workstreamRevision: source.workstream.revision,
      sourceRevisionDigest: source.sourceRevisionDigest,
      causationEventIds: [...authority.source.causationEventIds],
      evidenceStatus: source.graph.validity.status === "valid" ? "valid" : "conflict",
      workstreamStatus: source.workstream.status,
      authorityStatus: authority.installation.revoked
        ? "revoked"
        : Date.parse(this.now()) >= Date.parse(authority.installation.mandate.expiresAt)
          ? "expired"
          : Date.parse(this.now()) < Date.parse(authority.installation.mandate.issuedAt)
            ? "unobserved"
            : "active",
      ...tasks,
      handoffs: await readSupervisionHandoffState(
        {
          events: this.storage.events,
          artifacts: this.storage.artifacts,
          projectId: this.storage.manifest.projectId,
        },
        source,
        this.binding,
        this.now(),
      ),
      escalationCount: source.supervisionEvents.filter(
        (event) => event.type === "work.supervision.escalation.recorded",
      ).length,
      attentionPending: await hasPendingSupervisionAttention({
        storage: this.storage,
        source,
        binding: this.binding,
        now: this.now,
      }),
      pendingDecision: [...decisions.values()].some((status) =>
        ["recorded", "uncertain"].includes(status),
      ),
      ...(await observeResultDelivery({
        source,
        events: this.storage.events,
        artifacts: this.storage.artifacts,
        now: this.now(),
      })),
    };
  }
}
