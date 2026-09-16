import type { RecordedWorkResponsibility, WorkforceAssignment } from "@lervo/agent-workforce";
import { validateSchema } from "@lervo/schemas";
import { operatingContractHash, projectCompletionEvidence } from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";

type Source = Awaited<ReturnType<SupervisionTaskSource["read"]>>;

export interface ObservedSupervisionCompletion {
  assignmentRevision: number;
}

function exactRoleBindingMigrationChain(input: {
  source: Source;
  assignment: WorkforceAssignment;
  binding: RecordedWorkResponsibility;
  completionRevision: number;
  completionSequence: number;
  completionTime: string;
}): boolean {
  const { source, assignment, binding, completionRevision, completionSequence, completionTime } =
    input;
  if (assignment.revision === completionRevision)
    return (
      assignment.roleVersion === binding.responsibility.roleVersion &&
      assignment.roleContractHash === binding.responsibility.roleContractHash &&
      assignment.updatedAt === completionTime
    );
  const migrations = source.events
    .filter(
      (event) =>
        event.type === "assignment.role.binding.changed" &&
        event.payload.assignmentId === assignment.assignmentId &&
        Number(event.payload.revision) > completionRevision,
    )
    .sort((left, right) => Number(left.payload.revision) - Number(right.payload.revision));
  if (migrations.length !== assignment.revision - completionRevision) return false;
  let roleVersion = binding.responsibility.roleVersion;
  let roleContractHash = binding.responsibility.roleContractHash;
  let requiredCapabilityHash: unknown = migrations[0]?.payload.previousRequiredCapabilityHash;
  let sequence = completionSequence;
  for (const [index, event] of migrations.entries()) {
    if (
      event.actor.kind !== "system" ||
      event.seq <= sequence ||
      Number(event.payload.revision) !== completionRevision + index + 1 ||
      event.payload.roleId !== assignment.roleId ||
      event.payload.previousRoleVersion !== roleVersion ||
      event.payload.previousRoleContractHash !== roleContractHash ||
      event.payload.previousRequiredCapabilityHash !== requiredCapabilityHash
    )
      return false;
    roleVersion = String(event.payload.roleVersion);
    roleContractHash = String(event.payload.roleContractHash);
    requiredCapabilityHash = event.payload.requiredCapabilityHash;
    sequence = event.seq;
  }
  const last = migrations.at(-1);
  return (
    last !== undefined &&
    last.occurredAt === assignment.updatedAt &&
    roleVersion === assignment.roleVersion &&
    roleContractHash === assignment.roleContractHash &&
    requiredCapabilityHash === (assignment.requiredCapabilityHash ?? null)
  );
}

/** Recognizes exact settled completion through later administrative role-binding revisions. */
export function observeSupervisionCompletion(
  source: Source,
  assignment: WorkforceAssignment,
  binding: RecordedWorkResponsibility,
): ObservedSupervisionCompletion | null {
  const task = binding.responsibility;
  const completionRevision = task.assignmentRevision + 1;
  if (
    assignment.status !== "completed" ||
    assignment.revision < completionRevision ||
    assignment.assigneeAgentId !== task.executorAgentId ||
    assignment.lease !== null ||
    assignment.failureCode !== null ||
    assignment.roleId !== task.roleId ||
    task.expectedPaths.some(
      (path) =>
        !assignment.expectedPaths.some((root) => path === root || path.startsWith(`${root}/`)),
    ) ||
    (["acceptanceCriteria", "verificationSuiteIds"] as const).some(
      (key) => operatingContractHash(assignment[key]) !== operatingContractHash(task[key]),
    )
  )
    return null;
  const latest = source.execution.attempts.findLast(
    (attempt) => attempt.assignmentId === assignment.assignmentId,
  );
  if (latest === undefined) return null;
  const evidence = projectCompletionEvidence({
    events: source.events.filter((event) => event.runId === latest.runId),
    attempts: [latest],
    workstreamId: source.workstream.workstreamId,
  }).find(
    (item) =>
      item.assignmentRevision === task.assignmentRevision &&
      item.agentId === task.executorAgentId &&
      operatingContractHash(assignment.resultArtifacts) ===
        operatingContractHash([
          { artifactId: item.resultArtifactId, contentHash: item.resultContentHash },
        ]),
  );
  if (evidence === undefined) return null;
  const prepared = source.events.find(
    (event) =>
      event.type === "assignment.completion.prepared" &&
      event.payload.completionEvidenceId === evidence.completionEvidenceId,
  );
  const bound = source.events.find((event) => event.eventId === binding.eventId);
  const completed = source.events.filter(
    (event) =>
      event.type === "assignment.completion.reconciled" &&
      event.payload.assignmentId === assignment.assignmentId &&
      event.payload.revision === completionRevision,
  );
  const event = completed[0];
  if (
    prepared === undefined ||
    bound === undefined ||
    bound.seq >= prepared.seq ||
    completed.length !== 1 ||
    event === undefined ||
    event.actor.kind !== "system" ||
    event.seq <= prepared.seq ||
    Date.parse(event.occurredAt) < Date.parse(evidence.preparedAt) ||
    !validateSchema("assignmentCompletionReconciledEventPayload", event.payload).valid ||
    event.payload.reconciledAt !== event.occurredAt ||
    event.payload.completionEvidenceId !== evidence.completionEvidenceId ||
    event.payload.sourceRunId !== evidence.runId ||
    event.payload.agentId !== evidence.agentId ||
    event.payload.leaseId !== evidence.leaseId ||
    event.payload.resultArtifactId !== evidence.resultArtifactId ||
    event.payload.resultContentHash !== evidence.resultContentHash
  )
    return null;
  return exactRoleBindingMigrationChain({
    source,
    assignment,
    binding,
    completionRevision,
    completionSequence: event.seq,
    completionTime: event.occurredAt,
  })
    ? { assignmentRevision: completionRevision }
    : null;
}
