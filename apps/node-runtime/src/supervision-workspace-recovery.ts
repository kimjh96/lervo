import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { readWorkspace } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingDecisionId } from "@lervo/work-controller";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { assertSupervisionWorkspaceLocation } from "./supervision-workspace-plan.js";
import {
  recordSupervisionWorkspaceReceipt,
  supervisionWorkspaceReceiptBasis,
} from "./supervision-workspace-receipt.js";
import { readPreparedWorkspaceState } from "./supervision-workspace-prepared-state.js";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

/** Settles historical preparation under the current owner fence without reviving its old lease. */
export async function recoverPreparedWorkspace(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  configuration: NonNullable<NodeRuntimeReadinessConfiguration["workerWorkspace"]>;
  session: Pick<NodeSupervisionEffectSession, "commit">;
  now(): string;
}) {
  const { storage, plan } = input;
  const receipt = await supervisionWorkspaceReceiptBasis(storage, plan);
  const prepared = await readPreparedWorkspaceState(storage, receipt.provision);
  if (prepared === null || storage.events.get(receipt.eventId) !== null)
    return { status: "uncertain" as const };
  const tasks = new SupervisionTaskSource(storage, input.binding, input.now);
  const source = await tasks.read(operatingDecisionId(plan));
  // A dispatch for this responsibility makes this a worker recovery, not a preparation receipt.
  for (const event of source.events.filter(
    (event) =>
      event.type === "work.supervision.decision.recorded" &&
      event.payload.workstreamId === plan.workstreamId,
  )) {
    const candidate = (await readSupervisionJsonArtifact(
      storage.artifacts,
      String(event.payload.planHash),
    )) as OperatingActionPlanV1;
    if (
      ["work.managed_execution.v1", "work.managed_execution.v2"].includes(
        candidate.effectContract,
      ) &&
      candidate.responsibilityArtifactHash === plan.responsibilityArtifactHash
    )
      return { status: "uncertain" as const };
  }
  await assertSupervisionWorkspaceLocation(
    storage.paths.repositoryRoot,
    receipt.provision,
    input.configuration,
  );
  const home = await resolveRepositoryCoordinationHome(storage.paths.repositoryRoot);
  const inspectedAt = Date.parse(input.now());
  const observed = await new GitWorkspaceHostAdapter().inspectResult({
    repositoryRoot: storage.paths.repositoryRoot,
    workspacePath: receipt.provision.workspacePath,
    baseCommit: receipt.provision.baseCommit,
    marker: receipt.provision.marker,
  });
  if (
    home.repositoryInstanceId !== prepared.workspace.repositoryInstanceId ||
    observed.status !== "present" ||
    !observed.markerMatched ||
    observed.headCommit !== receipt.provision.baseCommit ||
    observed.nativeInstanceDigest !== prepared.workspace.host.nativeInstanceDigest ||
    observed.gitOperationInProgress !== false ||
    observed.changedPaths?.length !== 0
  )
    return { status: "uncertain" as const };
  const authority = await observeNodeSupervisionAuthority(storage, input.binding, input.now);
  const refreshed = await tasks.read(operatingDecisionId(plan));
  const current = await readWorkspace(storage.paths.repositoryRoot, prepared.workspace.workspaceId);
  if (
    authority.installation.revoked ||
    !authority.source.eligible ||
    refreshed.sourceRevisionDigest !== source.sourceRevisionDigest ||
    current?.contentHash !== prepared.stored.contentHash ||
    Date.parse(input.now()) - inspectedAt > 5_000 ||
    Date.parse(input.now()) >= Date.parse(authority.installation.mandate.expiresAt)
  )
    throw new Error("The historical workspace receipt lost its current reconciliation authority.");
  const result = await recordSupervisionWorkspaceReceipt({
    storage,
    plan,
    now: input.now,
    commit: (effect) =>
      input.session.commit(() => {
        if (storage.events.latest()?.eventHash !== refreshed.headEventHash)
          throw new Error("The workspace recovery source changed before receipt commit.");
        return effect();
      }),
  });
  return { status: "confirmed" as const, eventIds: result.eventIds };
}
