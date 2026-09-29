import { repositoryPathWithinScope } from "@lervo/work-controller";
import type { MandateInstallationSource, OperatingMandate } from "@lervo/application-contract";
import { projectAgentOrganization } from "@lervo/agent-organization";
import {
  assertCanonicalSupervisionIdentity,
  listAgents,
  listAssignments,
  workforceLimits,
} from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { inspectEventWriterCoordinate, loadProjectManifest } from "@lervo/project";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { resolveRoleContract } from "@lervo/roles";
import { collectProjectEventsBounded } from "@lervo/storage-contract";
import { observeOperatingWorkScope, operatingContractHash } from "@lervo/work-controller";
import type { SupervisionAuthorityHistory } from "./supervision-authority-history.js";
import { observeMandateExecutionAuthority } from "./supervision-execution-host.js";
import { readBoundWorkstreamState } from "./supervision-workstream-state.js";

/** Validates local history and the reviewed execution side without claiming remote convergence. */
export async function observeMandateInstallationSource(
  root: string,
  storage: ProjectStorage,
  mandate: OperatingMandate,
  workstreamState: "active" | "current" = "active",
  authorityHistory?: SupervisionAuthorityHistory,
  pendingCompletion?: {
    original: NonNullable<Awaited<ReturnType<typeof readCurrentWorkstreamState>>>;
    desiredSnapshotHash: string;
  },
  boundWorkstreamId?: string,
): Promise<MandateInstallationSource> {
  const manifest = await loadProjectManifest(root);
  const writer = await inspectEventWriterCoordinate(root);
  if (manifest.projectId !== storage.manifest.projectId)
    throw new Error("The mandate repository identity changed.");
  const executionAuthority = await observeMandateExecutionAuthority({
    mandate,
    hubSyncEnabled: manifest.dataPolicy.hubSyncEnabled,
  });
  if (
    (storage.writableEventSchemaVersion ?? 1) < 3 ||
    writer.coordinate.selectedEventSchemaVersion < 3
  )
    throw new Error("Mandate installation requires reviewed event writer version 3 activation.");
  if (authorityHistory === undefined && !storage.events.verifyIntegrity().valid)
    throw new Error("The mandate authority event history is invalid.");
  const history =
    authorityHistory === undefined
      ? collectProjectEventsBounded({ events: storage.events, maximumEvents: 100_000 })
      : await authorityHistory.read();
  const installedWorkstream =
    boundWorkstreamId === undefined
      ? await readCurrentWorkstreamState(root)
      : await readBoundWorkstreamState(storage, boundWorkstreamId, history);
  if (
    pendingCompletion !== undefined &&
    (installedWorkstream?.contentHash !== pendingCompletion.desiredSnapshotHash ||
      installedWorkstream.snapshot.workstreamId !==
        pendingCompletion.original.snapshot.workstreamId ||
      installedWorkstream.snapshot.revision !== pendingCompletion.original.snapshot.revision + 1 ||
      installedWorkstream.snapshot.status !== "completed")
  )
    throw new Error("The pending completion bytes differ from their reviewed transition.");
  // During durable apply, the new snapshot is written before its event. Only this exact
  // transition may use the still-canonical predecessor while rechecking all other authority.
  const workstream = pendingCompletion?.original ?? installedWorkstream;
  if (
    workstream === null ||
    (workstreamState === "active" && workstream.snapshot.status !== "active")
  )
    throw new Error("Mandate installation requires an active canonical workstream.");
  assertCanonicalSupervisionIdentity({
    events: history,
    projectId: storage.manifest.projectId,
    workstreamId: workstream.snapshot.workstreamId,
  });
  const cause = history.findLast(
    (event) =>
      event.type === "workstream.snapshot.recorded" &&
      event.payload.workstreamId === workstream.snapshot.workstreamId &&
      event.payload.revision === workstream.snapshot.revision &&
      event.payload.snapshotContentHash === workstream.contentHash,
  );
  if (cause === undefined) throw new Error("The current workstream has no exact canonical event.");
  const workScope =
    mandate.schemaVersion !== 3
      ? null
      : observeOperatingWorkScope({
          scope: mandate.workScope,
          projectId: storage.manifest.projectId,
          workstreamId: workstream.snapshot.workstreamId,
          events: history,
          assignments: await listAssignments(root),
        });
  const organization = projectAgentOrganization({
    projectId: storage.manifest.projectId,
    events: history.filter((event) => event.type.startsWith("organization.")),
  });
  const team = organization.team;
  if (team === null) throw new Error("The repository has no canonical team binding.");
  const agents = await listAgents(root, { readOnly: storage.readOnly === true });
  const owner = agents.find((agent) => agent.agentId === mandate.ownerAgentId);
  const membership = organization.memberships.find((item) => item.agentId === mandate.ownerAgentId);
  if (
    owner === undefined ||
    owner.status !== "active" ||
    owner.projectId !== storage.manifest.projectId ||
    membership?.status !== "active" ||
    membership.teamId !== team.teamId ||
    membership.roleId !== owner.roleId ||
    membership.roleVersion !== owner.roleVersion ||
    membership.roleContractHash !== owner.roleContractHash ||
    membership.roleProfileHash !== owner.roleProfileHash
  )
    throw new Error("The mandate owner lacks an exact active team and role binding.");
  const ancestry = [owner];
  while (ancestry.at(-1)!.parentAgentId !== null) {
    const child = ancestry.at(-1)!;
    const parent = agents.find((agent) => agent.agentId === child.parentAgentId);
    if (
      parent === undefined ||
      parent.status !== "active" ||
      ancestry.length > workforceLimits.maximumDelegationDepth ||
      ancestry.some((agent) => agent.agentId === parent.agentId) ||
      child.delegationDepth !== parent.delegationDepth + 1
    )
      throw new Error("The mandate owner ancestry is unavailable or invalid.");
    ancestry.push(parent);
  }
  if (ancestry.at(-1)!.delegationDepth !== 0)
    throw new Error("The mandate owner ancestry does not reach a root agent.");
  const roles = await Promise.all(
    [...new Set([...mandate.roleIds, ...ancestry.map((agent) => agent.roleId)])]
      .sort()
      .map((roleId) => resolveRoleContract(root, roleId)),
  );
  for (const agent of ancestry) {
    const role = roles.find((item) => item.roleId === agent.roleId)!;
    const capabilities: Record<string, string> = role.definition.profile.capabilities;
    if (
      mandate.capabilityCeiling.some(
        (capability) =>
          !Object.hasOwn(capabilities, capability) || capabilities[capability] === "deny",
      ) ||
      mandate.pathRoots.some(
        (path) =>
          !agent.responsibilityPaths.some((scope) => repositoryPathWithinScope(path, scope)),
      ) ||
      mandate.providers.some(
        (provider) =>
          !["codex", "claude"].includes(provider) ||
          (agent.provider !== "any" && agent.provider !== provider),
      )
    )
      throw new Error(
        "The mandate exceeds its owner ancestry capability, path, or provider ceiling.",
      );
  }
  return {
    projectId: storage.manifest.projectId,
    teamId: team.teamId,
    workstreamId: workstream.snapshot.workstreamId,
    workstreamRevision: workstream.snapshot.revision,
    sourceRevisionDigest: operatingContractHash({
      workstreamHash: workstream.contentHash,
      ancestry,
      roles,
      team,
      membership,
      dataPolicy: manifest.dataPolicy,
      writerHash: writer.contentHash,
      ...(mandate.schemaVersion !== 1 ? { executionAuthority } : {}),
      ...(workScope === null
        ? {}
        : {
            workScope: {
              anchorHash: workScope.anchor.eventHash,
              historicalAssignments: workScope.historicalAssignments,
            },
          }),
    }),
    causationEventIds: [cause.eventId],
    ownerAgentId: owner.agentId,
    eligible: true,
    reasonCodes: [],
  };
}
