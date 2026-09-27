import { listWorkspaceCoordinationEvents, readWorkspace } from "@lervo/agent-workforce";
import { canonicalJson } from "@lervo/event-contract";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingContractHash } from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionWorkspacePlan } from "./supervision-workspace-plan.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { readPreparedWorkspaceState } from "./supervision-workspace-prepared-state.js";

export async function supervisionWorkspaceReceiptBasis(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const admitted = await readAdmittedControlDecision(storage, plan);
  const basis = await readSupervisionWorkspacePlan(storage, plan);
  const eventId = `evt_${operatingContractHash({ runId: admitted.runId, type: "work.supervision.workspace.prepared", identity: admitted.identity }).slice(7, 39)}`;
  return { ...admitted, ...basis, eventId };
}

export async function recordSupervisionWorkspaceReceipt(input: {
  storage: ProjectStorage;
  plan: OperatingActionPlanV1;
  now(): string;
  commit<T>(effect: () => T): T;
}) {
  const { storage, plan } = input;
  const basis = await supervisionWorkspaceReceiptBasis(storage, plan);
  const prepared = await readPreparedWorkspaceState(storage, basis.provision);
  if (prepared === null)
    throw new Error("The exact ready workspace has no canonical coordination evidence.");
  const artifact = await storage.artifacts.put(canonicalJson(prepared.workspace));
  const evidence = await storage.artifacts.put(canonicalJson(prepared.coordinates));
  const payload = {
    schemaVersion: 1,
    projectId: plan.projectId,
    workstreamId: plan.workstreamId,
    workstreamRevision: basis.decision.payload.workstreamRevision,
    supervisionId: plan.supervisionId,
    ownerAgentId: plan.ownerAgentId,
    mandateHash: plan.mandateHash,
    causationEventIds: [basis.decision.eventId],
    decisionId: basis.identity,
    planHash: operatingContractHash(plan),
    assignmentId: basis.effect.responsibility.assignmentId,
    workspaceId: prepared.workspace.workspaceId,
    provisionPlanHash: basis.effect.provisionPlanHash,
    workspaceArtifactHash: artifact.contentHash,
    coordinationEvidenceHash: evidence.contentHash,
  };
  input.commit(() =>
    storage.events.append({
      eventId: basis.eventId,
      projectId: plan.projectId,
      runId: basis.runId,
      sessionId: basis.decision.sessionId,
      type: "work.supervision.workspace.prepared",
      schemaVersion: 3,
      occurredAt: input.now(),
      actor: { kind: "system" },
      policyVersion: plan.mandateHash,
      payload,
    }),
  );
  return { eventIds: [basis.eventId] };
}

/** Historical preparation proves host creation; current dispatch still inspects the live workspace. */
export async function inspectSupervisionWorkspaceReceipt(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const basis = await supervisionWorkspaceReceiptBasis(storage, plan);
  const event = storage.events.get(basis.eventId);
  if (event === null) {
    const workspace = await readWorkspace(
      storage.paths.repositoryRoot,
      basis.provision.workspace.workspaceId,
    );
    return { status: workspace === null ? ("not_started" as const) : ("uncertain" as const) };
  }
  if (
    event.type !== "work.supervision.workspace.prepared" ||
    event.schemaVersion !== 3 ||
    event.actor.kind !== "system" ||
    event.seq <= basis.decision.seq ||
    event.runId !== basis.runId ||
    event.payload.planHash !== operatingContractHash(plan) ||
    event.payload.decisionId !== basis.identity ||
    event.payload.provisionPlanHash !== basis.effect.provisionPlanHash ||
    event.payload.workspaceId !== basis.provision.workspace.workspaceId ||
    event.payload.assignmentId !== basis.effect.responsibility.assignmentId ||
    operatingContractHash(event.payload.causationEventIds) !==
      operatingContractHash([basis.decision.eventId])
  )
    return { status: "uncertain" as const };
  const workspace = (await readSupervisionJsonArtifact(
    storage.artifacts,
    String(event.payload.workspaceArtifactHash),
  )) as typeof basis.provision.workspace;
  const expected = {
    ...basis.provision.workspace,
    state: "ready",
    revision: 2,
    host: {
      ...basis.provision.workspace.host,
      nativeInstanceDigest: workspace.host.nativeInstanceDigest,
    },
    updatedAt: workspace.updatedAt,
  };
  const coordinates = (await listWorkspaceCoordinationEvents(storage.paths.repositoryRoot)).filter(
    (item) =>
      [basis.provision.provisionEventId, basis.provision.readyEventId].includes(item.eventId),
  );
  if (
    workspace.host.nativeInstanceDigest === null ||
    operatingContractHash(workspace) !== operatingContractHash(expected) ||
    coordinates.length !== 2 ||
    operatingContractHash(coordinates) !== event.payload.coordinationEvidenceHash
  )
    return { status: "uncertain" as const };
  return { status: "confirmed" as const, eventIds: [event.eventId] };
}
