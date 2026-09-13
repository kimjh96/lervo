import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { listAssignments } from "@lervo/agent-workforce";
import {
  completionEvidenceId,
  operatingContractHash,
  managedExecutionIdentity,
} from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readAssignmentCompletionEffect } from "./supervision-assignment-completion-source.js";

export async function assignmentCompletionReceiptBasis(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const admitted = await readAdmittedControlDecision(storage, plan);
  const basis = await readAssignmentCompletionEffect(storage, plan);
  const assignment = basis.context.facts.assignments.find(
    (item) => item.assignmentId === basis.effect.responsibility.assignmentId,
  );
  const task = basis.context.facts.tasks.assignments.find(
    (item) => item.assignmentId === assignment?.assignmentId,
  );
  const terminal =
    task?.terminalEventId === null || task === undefined
      ? null
      : storage.events.get(task.terminalEventId);
  if (assignment?.lease === null || assignment === undefined || terminal?.type !== "run.completed")
    throw new Error("The completion receipt has no exact original task run and lease.");
  const coordinate = {
    workstreamId: plan.workstreamId,
    assignmentId: assignment.assignmentId,
    assignmentRevision: assignment.revision,
    agentId: assignment.assigneeAgentId!,
    leaseId: assignment.lease.leaseId,
    runId: terminal.runId,
    sessionId: terminal.sessionId,
    resultArtifactId: basis.writing.artifact.artifactId,
    resultContentHash: basis.writing.artifact.contentHash,
    preparedAt: basis.effect.preparedAt,
  };
  const evidenceId = completionEvidenceId(coordinate);
  const preparedEventId = `evt_${operatingContractHash({ planHash: operatingContractHash(plan), type: "assignment.completion.prepared" }).slice(7, 39)}`;
  const reconciledEventId = `evt_${operatingContractHash({ planHash: operatingContractHash(plan), type: "assignment.completion.reconciled" }).slice(7, 39)}`;
  const commandId = `gcr_${operatingContractHash(plan).slice(7, 31)}`;
  const { runId: _runId, sessionId: _sessionId, ...payload } = coordinate;
  return {
    ...basis,
    ...admitted,
    assignment,
    terminal,
    coordinate,
    evidenceId,
    preparedEventId,
    reconciledEventId,
    commandId,
    preparedPayload: {
      ...payload,
      completionEvidenceId: evidenceId,
      verificationStatus: "passed",
      writingPublicationStatus: "allowed",
    },
  };
}

export async function inspectAssignmentCompletionReceipt(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const basis = await assignmentCompletionReceiptBasis(storage, plan);
  const prepared = storage.events.get(basis.preparedEventId);
  const reconciled = storage.events.get(basis.reconciledEventId);
  const assignment = (await listAssignments(storage.paths.repositoryRoot)).find(
    (item) => item.assignmentId === basis.assignment.assignmentId,
  );
  if (prepared === null && reconciled === null)
    return {
      status:
        assignment !== undefined &&
        operatingContractHash(assignment) === basis.effect.expectedAssignmentHash
          ? ("not_started" as const)
          : ("uncertain" as const),
    };
  if (
    prepared?.type !== "assignment.completion.prepared" ||
    prepared.schemaVersion !== 3 ||
    prepared.actor.kind !== "system" ||
    prepared.runId !== basis.coordinate.runId ||
    prepared.sessionId !== basis.coordinate.sessionId ||
    prepared.seq <= basis.decision.seq ||
    operatingContractHash(prepared.payload) !== operatingContractHash(basis.preparedPayload) ||
    reconciled?.type !== "assignment.completion.reconciled" ||
    reconciled.schemaVersion !== 3 ||
    reconciled.actor.kind !== "system" ||
    reconciled.seq <= prepared.seq ||
    reconciled.runId !==
      managedExecutionIdentity(plan.projectId, operatingContractHash(plan)).runId ||
    assignment?.status !== "completed" ||
    assignment.revision !== basis.assignment.revision + 1 ||
    assignment.lease !== null ||
    reconciled.payload.revision !== assignment.revision ||
    reconciled.occurredAt !== assignment.updatedAt ||
    reconciled.payload.reconciledAt !== assignment.updatedAt ||
    reconciled.payload.completionEvidenceId !== basis.evidenceId ||
    reconciled.payload.reconciliationCommandId !== basis.commandId ||
    reconciled.payload.sourceRunId !== basis.terminal.runId ||
    ["assignmentId", "agentId", "leaseId", "resultArtifactId", "resultContentHash"].some(
      (key) => reconciled.payload[key] !== basis.coordinate[key as keyof typeof basis.coordinate],
    ) ||
    operatingContractHash(assignment.resultArtifacts) !==
      operatingContractHash([
        {
          artifactId: basis.coordinate.resultArtifactId,
          contentHash: basis.coordinate.resultContentHash,
        },
      ])
  )
    return { status: "uncertain" as const };
  return { status: "confirmed" as const, eventIds: [prepared.eventId, reconciled.eventId] };
}
