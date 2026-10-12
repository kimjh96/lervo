import {
  listWorkspaceCoordinationEvents,
  readWorkspace,
  type WorkspaceCoordinationEvent,
} from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import type { WorkspaceProvisionPlan } from "@lervo/orchestrator";
import { operatingContractHash } from "@lervo/work-controller";

/**
 * Reads exact preparation history, including a legacy receipt failure after host readiness.
 * `workspaceEvents` lets a caller that checks many workspaces read the coordination events once.
 */
export async function readPreparedWorkspaceState(
  storage: ProjectStorage,
  provision: WorkspaceProvisionPlan,
  workspaceEvents?: readonly WorkspaceCoordinationEvent[],
) {
  const stored = await readWorkspace(storage.paths.repositoryRoot, provision.workspace.workspaceId);
  if (stored === null || stored.workspace.host.nativeInstanceDigest === null) return null;
  const coordinates = (
    workspaceEvents ?? (await listWorkspaceCoordinationEvents(storage.paths.repositoryRoot))
  ).filter((event) => event.workspaceId === provision.workspace.workspaceId);
  const created = coordinates.find((event) => event.eventId === provision.provisionEventId);
  const ready = coordinates.find((event) => event.eventId === provision.readyEventId);
  const recovery = coordinates.find((event) => event.eventId === provision.recoveryEventId);
  const retained = stored.workspace.state === "recovery_required";
  if (
    coordinates.length !== (retained ? 3 : 2) ||
    created?.type !== "agent.workspace.provisioned" ||
    created.previousState !== "absent" ||
    created.state !== "provisioning" ||
    created.revision !== 1 ||
    created.occurredAt !== provision.createdAt ||
    ready?.type !== "agent.workspace.state.changed" ||
    ready.previousState !== "provisioning" ||
    ready.state !== "ready" ||
    ready.revision !== 2 ||
    (retained &&
      (recovery?.type !== "agent.workspace.state.changed" ||
        recovery.previousState !== "ready" ||
        recovery.state !== "recovery_required" ||
        recovery.revision !== 3 ||
        recovery.reasonCode !== "host_effect_uncertain")) ||
    coordinates.some(
      (event) =>
        event.generation !== provision.workspace.generation ||
        event.assignmentId !== provision.assignmentId ||
        event.agentId !== provision.agentId ||
        event.repositoryInstanceId !== provision.workspace.repositoryInstanceId ||
        event.hostKind !== provision.workspace.host.kind ||
        event.hostVersion !== provision.workspace.host.version ||
        event.baseCommit !== provision.baseCommit ||
        event.integrationTargetDigest !== provision.workspace.integrationTargetDigest,
    )
  )
    return null;
  const workspace = {
    ...provision.workspace,
    state: "ready" as const,
    revision: 2,
    host: {
      ...provision.workspace.host,
      nativeInstanceDigest: stored.workspace.host.nativeInstanceDigest,
    },
    updatedAt: ready.occurredAt,
  };
  const expected = retained
    ? {
        ...workspace,
        state: "recovery_required",
        revision: 3,
        recoveryReason: "host_effect_uncertain",
        updatedAt: recovery!.occurredAt,
      }
    : workspace;
  if (operatingContractHash(stored.workspace) !== operatingContractHash(expected)) return null;
  return {
    stored,
    workspace,
    coordinates: coordinates.filter((event) => event.eventId !== provision.recoveryEventId),
    retained,
  };
}
