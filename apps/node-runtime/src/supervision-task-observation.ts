import { observedSupervisionRunTermination } from "./supervision-run-termination.js";
import { observeSupervisionFailure } from "./supervision-failure-observation.js";
import { createHash } from "node:crypto";
import type { SupervisedAssignmentObservationV1 } from "@lervo/application-contract";
import { validateSchema } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { observedSupervisionCompletion } from "./supervision-completion-observation.js";

import { observeSupervisedArtifactReview } from "./supervision-review-observation.js";

type Source = Awaited<ReturnType<SupervisionTaskSource["read"]>>;

async function artifactBytes(artifacts: ArtifactStore, hash: string): Promise<Uint8Array> {
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash)) throw new Error("The task result hash is invalid.");
  const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  if (
    bytes.byteLength > 1024 * 1024 ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== hash
  )
    throw new Error("The task result artifact is unavailable or corrupt.");
  return bytes;
}

/** Projects execution evidence without turning a requested run or a failed process into acceptance. */
export async function observeSupervisionTasks(
  source: Source,
  artifacts: ArtifactStore,
  authority: NodeSupervisionBinding,
  eventStore: EventStore,
) {
  const assignments: SupervisedAssignmentObservationV1[] = [];
  const unboundAssignmentIds: string[] = [];
  for (const assignment of source.assignments) {
    if (
      source.workstream.status === "cancelled" &&
      assignment.status === "cancelled" &&
      assignment.revision === 2 &&
      assignment.lease === null &&
      !source.execution.attempts.some(
        (attempt) => attempt.assignmentId === assignment.assignmentId,
      ) &&
      source.events.some(
        (event) =>
          event.type === "assignment.cancelled" &&
          event.actor.kind === "system" &&
          event.payload.assignmentId === assignment.assignmentId &&
          ["queued", "blocked"].includes(String(event.payload.previousStatus)) &&
          event.payload.revision === assignment.revision &&
          event.occurredAt === assignment.updatedAt,
      )
    )
      continue;
    const binding = source.responsibilities.find(
      (item) => item.assignmentId === assignment.assignmentId,
    )?.binding;
    if (
      binding === null ||
      binding === undefined ||
      (binding.responsibility.assignmentRevision !== assignment.revision &&
        !observedSupervisionCompletion(source, assignment, binding))
    ) {
      unboundAssignmentIds.push(assignment.assignmentId);
      continue;
    }
    const task = binding.responsibility;
    const bindingSequence =
      source.events.find((event) => event.eventId === binding.eventId)?.seq ??
      Number.MAX_SAFE_INTEGER;
    const attempts = source.execution.attempts.filter(
      (item) =>
        item.assignmentId === assignment.assignmentId &&
        source.events.some(
          (event) =>
            event.runId === item.runId &&
            event.type === "run.requested" &&
            event.seq > bindingSequence,
        ),
    );
    const attempt = attempts.at(-1);
    const events =
      attempt === undefined ? [] : source.events.filter((event) => event.runId === attempt.runId);
    const requested = events.find((event) => event.type === "run.requested");
    const started = events.find((event) => event.type === "adapter.started");
    const terminal = events.find((event) => ["run.completed", "run.failed"].includes(event.type));
    const termination = observedSupervisionRunTermination(events);
    const failure = await observeSupervisionFailure(events, artifacts);
    const artifactHashes: string[] = [];
    const verification: SupervisedAssignmentObservationV1["verification"] = [];
    if (terminal?.type === "run.completed") {
      if (!validateSchema("runCompletedEventPayload", terminal.payload).valid)
        throw new Error("The supervised terminal evidence is malformed.");
      const resultHash = String(terminal.payload.resultDigest);
      await artifactBytes(artifacts, resultHash);
      artifactHashes.push(resultHash);
      for (const event of events.filter(
        (item) => item.type === "verification.completed" && item.seq < terminal.seq,
      )) {
        const payload = event.payload;
        if (
          !validateSchema("verificationCompletedEventPayload", payload).valid ||
          !(terminal.payload.artifactIds as string[]).includes(String(payload.resultArtifactId))
        )
          throw new Error("Verification is not bound to the supervised terminal artifact set.");
        const bytes = await artifactBytes(artifacts, String(payload.resultContentHash));
        const result = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ) as Record<string, unknown>;
        if (
          !validateSchema("verificationResult", result).valid ||
          ["verificationId", "suiteId", "suiteHash", "repositoryRevision", "status"].some(
            (key) => result[key] !== payload[key],
          )
        )
          throw new Error("The supervised verification artifact differs from its event.");
        verification.push({
          suiteId: String(payload.suiteId),
          eventId: event.eventId,
          artifactHashes: [resultHash],
          status: payload.status === "passed" ? "passed" : "failed",
        });
      }
    }
    const review = source.supervisionEvents.findLast(
      (event) =>
        event.type === "work.supervision.review.recorded" &&
        event.seq > bindingSequence &&
        terminal !== undefined &&
        event.seq > terminal.seq &&
        (event.payload.assignmentIds as string[]).length === 1 &&
        (event.payload.assignmentIds as string[])[0] === assignment.assignmentId &&
        event.schemaVersion === 3 &&
        event.actor.kind === "system" &&
        event.payload.ownerAgentId === authority.ownerAgentId,
    );
    const observation: SupervisedAssignmentObservationV1 = {
      assignmentId: assignment.assignmentId,
      revision: assignment.revision,
      executorAgentId: task.executorAgentId,
      acceptanceOwnerAgentId: task.reviewerAgentId,
      responsibilityArtifactHash: binding.responsibilityHash,
      status: failure?.status === "known_safe_failure" ? "failed" : assignment.status,
      dispatchedAt: requested?.occurredAt ?? null,
      startedAt: started?.occurredAt ?? null,
      startDeadline: task.startDeadline,
      progressDeadline: task.progressDeadline,
      completionDeadline: task.completionDeadline,
      terminalEventId: terminal?.eventId ?? null,
      effectDisposition:
        terminal === undefined
          ? "not_started"
          : terminal.type === "run.completed" && termination?.terminal.eventId === terminal.eventId
            ? "reconciled"
            : (failure?.status ?? "uncertain"),
      recoveryDecisionCount: Math.max(
        0,
        (assignment.recovery?.attemptNumber ?? attempt?.attemptOrdinal ?? 1) - 1,
      ),
      artifactHashes,
      requiredVerificationSuiteIds: [...task.verificationSuiteIds],
      verification,
      acceptanceHash: operatingContractHash(task.acceptanceCriteria),
      review: null,
    };
    observation.review = await observeSupervisedArtifactReview({
      events: eventStore,
      artifacts,
      candidate: review,
      authority,
      assignment: observation,
    });
    assignments.push(observation);
  }
  return { assignments, unboundAssignmentIds };
}
