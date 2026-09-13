import type { RecordedWorkResponsibility, WorkforceAssignment } from "@lervo/agent-workforce";
import { validateSchema } from "@lervo/schemas";
import { operatingContractHash, projectCompletionEvidence } from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";

type Source = Awaited<ReturnType<SupervisionTaskSource["read"]>>;

/** Recognizes an exact recorded completion transition, without rebinding or accepting its result. */
export function observedSupervisionCompletion(
  source: Source,
  assignment: WorkforceAssignment,
  binding: RecordedWorkResponsibility,
): boolean {
  const task = binding.responsibility;
  if (
    assignment.status !== "completed" ||
    assignment.revision !== task.assignmentRevision + 1 ||
    assignment.assigneeAgentId !== task.executorAgentId ||
    assignment.lease !== null ||
    assignment.failureCode !== null ||
    assignment.roleId !== task.roleId ||
    assignment.roleVersion !== task.roleVersion ||
    assignment.roleContractHash !== task.roleContractHash ||
    task.expectedPaths.some(
      (path) =>
        !assignment.expectedPaths.some((root) => path === root || path.startsWith(`${root}/`)),
    ) ||
    (["acceptanceCriteria", "verificationSuiteIds"] as const).some(
      (key) => operatingContractHash(assignment[key]) !== operatingContractHash(task[key]),
    )
  )
    return false;
  const latest = source.execution.attempts.findLast(
    (attempt) => attempt.assignmentId === assignment.assignmentId,
  );
  if (latest === undefined) return false;
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
  if (evidence === undefined) return false;
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
      event.payload.revision === assignment.revision,
  );
  const event = completed[0];
  return (
    prepared !== undefined &&
    bound !== undefined &&
    bound.seq < prepared.seq &&
    completed.length === 1 &&
    event !== undefined &&
    event.actor.kind === "system" &&
    event.seq > prepared.seq &&
    event.occurredAt === assignment.updatedAt &&
    Date.parse(event.occurredAt) >= Date.parse(evidence.preparedAt) &&
    validateSchema("assignmentCompletionReconciledEventPayload", event.payload).valid &&
    event.payload.reconciledAt === event.occurredAt &&
    event.payload.completionEvidenceId === evidence.completionEvidenceId &&
    event.payload.sourceRunId === evidence.runId &&
    event.payload.agentId === evidence.agentId &&
    event.payload.leaseId === evidence.leaseId &&
    event.payload.resultArtifactId === evidence.resultArtifactId &&
    event.payload.resultContentHash === evidence.resultContentHash
  );
}
