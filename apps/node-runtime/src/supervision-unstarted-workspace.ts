import type { AgentWorkspace, WorkforceAssignment } from "@lervo/agent-workforce";
import { readWorkspace } from "@lervo/agent-workforce";
import type {
  OperatingActionPlanV1,
  SupervisedManagedExecution,
  SupervisedWorkspacePreparationV1,
} from "@lervo/application-contract";
import type { WorkspaceProvisionPlan } from "@lervo/orchestrator";
import { openReadOnlyProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { resolve } from "node:path";
import type { EventEnvelope } from "@lervo/schemas";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  managedExecutionIdentity,
  operatingContractHash,
  supervisedManagedExecutionFields,
  supervisedWorkspacePreparationFields,
} from "@lervo/work-controller";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import {
  readAdmittedControlDecision,
  readHistoricalManagedDecision,
} from "./supervision-control-decision.js";
import { readSupervisionJsonArtifact as readJson } from "./supervision-artifact-json.js";

/** Retains a never-used checkout; this observation grants no authority to write or remove it. */
export async function observeUnstartedSupervisionWorkspace(input: {
  repositoryRoot: string;
  binding: NodeSupervisionBinding;
  assignment: WorkforceAssignment;
  workspace: AgentWorkspace;
  now?: () => string;
  storage?: ProjectStorage;
}) {
  const { assignment, workspace, binding } = input;
  const now = input.now ?? (() => new Date().toISOString());
  const started = now();
  if (
    workspace.assignmentId !== assignment.assignmentId ||
    workspace.projectId !== assignment.projectId ||
    workspace.state !== "ready" ||
    workspace.revision !== 2 ||
    workspace.writerSession !== null ||
    workspace.recoveryReason !== null ||
    workspace.ownerWorkspacePath === undefined ||
    workspace.host.kind !== "git" ||
    workspace.host.nativeInstanceDigest === null ||
    assignment.workstreamId !== binding.workstreamId ||
    (workspace.leaseGeneration === assignment.lease?.generation &&
      Date.parse(assignment.lease.expiresAt) > Date.parse(started))
  )
    return null;
  const storage = input.storage ?? (await openReadOnlyProjectStorage(input.repositoryRoot));
  try {
    if (
      storage.paths.repositoryRoot !== resolve(input.repositoryRoot) ||
      storage.manifest.projectId !== assignment.projectId
    )
      throw new Error("Retained workspace evidence belongs to another repository.");
    const head = storage.events.latest();
    const supervisionRunId = `run_${operatingContractHash({ supervisionId: binding.supervisionId }).slice(7, 39)}`;
    const dispatchRunIds = new Set<string>();
    const history = collectRunEventsBounded({
      events: storage.events,
      runId: supervisionRunId,
      maximumEvents: 4096,
    });
    const prepared = history.filter(
      (event) =>
        event.type === "work.supervision.workspace.prepared" &&
        event.payload.workspaceId === workspace.workspaceId,
    );
    if (prepared.length !== 1) return null;
    const receipt = prepared[0]!;
    if (
      receipt.payload.workspaceArtifactHash !== operatingContractHash(workspace) ||
      operatingContractHash(
        await readJson(storage.artifacts, String(receipt.payload.workspaceArtifactHash)),
      ) !== operatingContractHash(workspace)
    )
      return null;
    const plan = (await readJson(
      storage.artifacts,
      String(receipt.payload.planHash),
    )) as OperatingActionPlanV1;
    const admitted = await readAdmittedControlDecision(storage, plan);
    const effect = (await readJson(
      storage.artifacts,
      plan.effectHash,
    )) as SupervisedWorkspacePreparationV1;
    const fields = supervisedWorkspacePreparationFields(effect);
    const provision = (await readJson(
      storage.artifacts,
      effect.provisionPlanHash,
    )) as WorkspaceProvisionPlan;
    const { contentHash, ...provisionContent } = provision;
    if (
      plan.supervisionId !== binding.supervisionId ||
      plan.workstreamId !== binding.workstreamId ||
      plan.ownerAgentId !== binding.ownerAgentId ||
      receipt.schemaVersion !== 3 ||
      receipt.actor.kind !== "system" ||
      receipt.projectId !== plan.projectId ||
      ["supervisionId", "workstreamId", "ownerAgentId", "mandateHash"].some(
        (key) => receipt.payload[key] !== plan[key as keyof OperatingActionPlanV1],
      ) ||
      receipt.payload.decisionId !== admitted.identity ||
      receipt.seq <= admitted.decision.seq ||
      receipt.payload.assignmentId !== assignment.assignmentId ||
      receipt.payload.provisionPlanHash !== effect.provisionPlanHash ||
      Object.entries(fields).some(
        ([key, value]) =>
          operatingContractHash(value) !==
          operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
      ) ||
      contentHash !== operatingContractHash(provisionContent) ||
      provision.planKind !== "workspace_provision" ||
      provision.planId !== workspace.creationPlanId ||
      provision.workspace.workspaceId !== workspace.workspaceId ||
      provision.assignmentId !== assignment.assignmentId ||
      provision.leaseGeneration !== workspace.leaseGeneration ||
      provision.workspacePath !== workspace.ownerWorkspacePath ||
      provision.agentId !== workspace.agentId ||
      provision.baseCommit !== workspace.baseCommit
    )
      return null;
    let absenceHash: string | null = null;
    for (const event of history.filter(
      (event) => event.type === "work.supervision.decision.recorded",
    )) {
      const candidate = (await readJson(
        storage.artifacts,
        String(event.payload.planHash),
      )) as OperatingActionPlanV1;
      if (
        !["work.managed_execution.v1", "work.managed_execution.v2"].includes(
          candidate.effectContract,
        ) ||
        candidate.responsibilityArtifactHash !== plan.responsibilityArtifactHash
      )
        continue;
      const managed = (await readJson(
        storage.artifacts,
        candidate.effectHash,
      )) as SupervisedManagedExecution;
      if (
        managed.leaseId !== provision.leaseId ||
        managed.responsibility.assignmentId !== assignment.assignmentId
      )
        continue;
      if (
        Object.entries(supervisedManagedExecutionFields(managed)).some(
          ([key, value]) =>
            operatingContractHash(value) !==
            operatingContractHash(candidate[key as keyof OperatingActionPlanV1]),
        )
      )
        throw new Error("Retained workspace dispatch evidence differs from its plan.");
      dispatchRunIds.add(
        managedExecutionIdentity(candidate.projectId, operatingContractHash(candidate)).runId,
      );
      if (!(await readHistoricalManagedDecision(storage, candidate)).superseded) return null;
      const supersession = history.find(
        (item) =>
          item.type === "work.supervision.decision.superseded" &&
          item.payload.decisionId === event.payload.decisionId,
      );
      if (supersession === undefined) return null;
      absenceHash = String(supersession.payload.inspectionArtifactHash);
    }
    // Admission can reject a dispatch before recording any decision, such as at the budget gate.
    // The managed CLI cannot reserve or start without that exact recorded decision.
    absenceHash ??= operatingContractHash({
      kind: "unrecorded_dispatch",
      workspacePreparationPlanHash: operatingContractHash(plan),
      workspacePreparationEventHash: receipt.eventHash,
    });
    const observed = await new GitWorkspaceHostAdapter().inspectResult({
      repositoryRoot: input.repositoryRoot,
      workspacePath: workspace.ownerWorkspacePath,
      baseCommit: workspace.baseCommit,
      marker: provision.marker,
    });
    const after = await readWorkspace(input.repositoryRoot, workspace.workspaceId);
    const elapsed = Date.parse(now()) - Date.parse(started);
    if (
      observed.status !== "present" ||
      !observed.markerMatched ||
      observed.headCommit !== workspace.baseCommit ||
      observed.nativeInstanceDigest !== workspace.host.nativeInstanceDigest ||
      observed.gitOperationInProgress !== false ||
      observed.changedPaths?.length !== 0 ||
      after === null ||
      operatingContractHash(after.workspace) !== operatingContractHash(workspace) ||
      // A running worker of the current generation keeps appending its own events; only an event
      // that could touch this generation, its assignment, the owner journal or its old dispatch
      // invalidates the proof.
      changedSince(
        storage,
        head?.seq ?? 0,
        (event) =>
          event.runId === supervisionRunId ||
          dispatchRunIds.has(event.runId) ||
          event.payload.workspaceId === workspace.workspaceId ||
          event.payload.assignmentId === assignment.assignmentId,
      ) ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      elapsed > 5000
    )
      return null;
    return {
      assignmentId: assignment.assignmentId,
      workspaceId: workspace.workspaceId,
      leaseGeneration: workspace.leaseGeneration,
      evidenceHash: operatingContractHash({
        workspace: operatingContractHash(workspace),
        absenceHash,
        observed,
      }),
    };
  } finally {
    if (input.storage === undefined) await storage.close();
  }
}

/** Whether any event after `afterSeq` matches; an unbounded tail counts as a change. */
function changedSince(
  storage: Pick<ProjectStorage, "events">,
  afterSeq: number,
  relevant: (event: EventEnvelope) => boolean,
): boolean {
  let seq = afterSeq;
  for (let page = 0; page < 16; page += 1) {
    const events = storage.events.list({ afterSeq: seq, limit: 1000 });
    if (events.some(relevant)) return true;
    if (events.length < 1000) return false;
    seq = events.at(-1)!.seq;
  }
  return true;
}
