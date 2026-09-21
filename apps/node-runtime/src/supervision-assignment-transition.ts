import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import {
  listAgents,
  listAssignments,
  listWorkspaces,
  type WorkforceAssignment,
  type WorkforceEventRecorder,
} from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import { readBoundWorkstreamState } from "./supervision-workstream-state.js";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";

/** Shares the final owner/event/source fence for reversible assignment amendments and reopening. */
export async function commitSupervisedAssignmentTransition(input: {
  storage: ProjectStorage;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  authority: Awaited<ReturnType<typeof observeNodeSupervisionAuthority>>;
  workspaces: Awaited<ReturnType<typeof listWorkspaces>>;
  expected: WorkforceAssignment;
  eventId: string;
  session: Pick<NodeSupervisionEffectSession, "commit">;
  now(): string;
  transition(recordEvent: WorkforceEventRecorder): Promise<WorkforceAssignment>;
}) {
  const { storage, binding, plan, source, authority, expected } = input;
  const root = storage.paths.repositoryRoot;
  const head = storage.events.latest()?.eventHash;
  const assignments = await listAssignments(root);
  const others = (items: typeof assignments) =>
    items.filter((item) => item.assignmentId !== expected.assignmentId);
  if (
    operatingContractHash(assignments) !== operatingContractHash(source.allAssignments) ||
    authority.installation.revoked ||
    !authority.source.eligible ||
    Date.parse(input.now()) >=
      Math.min(Date.parse(plan.deadline), Date.parse(authority.installation.mandate.expiresAt)) ||
    operatingContractHash({
      authorityDigest: authority.source.sourceRevisionDigest,
      taskDigest: source.sourceRevisionDigest,
    }) !== plan.sourceRevisionDigest
  )
    throw new Error("The assignment transition authority changed before mutation.");
  await input.transition(async (event) => {
    const fresh = await observeNodeSupervisionAuthority(storage, binding, input.now);
    const current = await listAssignments(root);
    const agents = await listAgents(root);
    const workstream = await readBoundWorkstreamState(storage, binding.workstreamId);
    const workspaces = (await listWorkspaces(root)).filter(
      (item) => item.assignmentId === expected.assignmentId,
    );
    input.session.commit(() => {
      if (
        fresh.installation.revoked ||
        !fresh.source.eligible ||
        fresh.source.sourceRevisionDigest !== authority.source.sourceRevisionDigest ||
        Date.parse(input.now()) >=
          Math.min(Date.parse(plan.deadline), Date.parse(fresh.installation.mandate.expiresAt)) ||
        operatingContractHash(
          current.find((item) => item.assignmentId === expected.assignmentId),
        ) !== operatingContractHash(expected) ||
        operatingContractHash(others(current)) !== operatingContractHash(others(assignments)) ||
        operatingContractHash(agents) !== operatingContractHash(source.agents) ||
        operatingContractHash(workspaces) !== operatingContractHash(input.workspaces) ||
        workstream?.contentHash !== source.workstreamHash ||
        storage.events.latest()?.eventHash !== head
      )
        throw new Error("Assignment sources changed while committing the transition.");
      storage.events.append({
        eventId: input.eventId,
        projectId: plan.projectId,
        ...managedExecutionIdentity(plan.projectId, operatingContractHash(plan)),
        type: event.type,
        schemaVersion: 3,
        occurredAt: expected.updatedAt,
        actor: { kind: "system" },
        policyVersion: plan.mandateHash,
        payload: event.payload,
      });
    });
  });
  return { eventIds: [input.eventId] };
}
