import { createHash } from "node:crypto";
import { SupervisionArtifactReviewJournal } from "@lervo/agent-workforce";
import type {
  OperatingActionPlanV1,
  SupervisedArtifactReviewV1,
  SupervisedAssignmentObservationV1,
} from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { assertSupervisedReviewBasis, operatingContractHash } from "@lervo/work-controller";
import type { NodeSupervisionBinding } from "./supervision-authority.js";

async function readJson(artifacts: ArtifactStore, hash: string) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash)) throw new Error("The review artifact hash is invalid.");
  const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  if (
    bytes.byteLength > 256 * 1024 ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== hash
  )
    throw new Error("The review artifact is unavailable or corrupt.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

/** A bare review event is not acceptance: recover and inspect the exact admitted owner decision. */
async function readReview(input: {
  events: EventStore;
  artifacts: ArtifactStore;
  candidate: NonNullable<ReturnType<EventStore["get"]>> | undefined;
  authority: NodeSupervisionBinding;
}) {
  const { candidate, events, artifacts, authority } = input;
  if (candidate === undefined) return null;
  const decision = events.get(String((candidate.payload.causationEventIds as string[])[0]));
  if (decision?.type !== "work.supervision.decision.recorded") return null;
  const plan = (await readJson(
    artifacts,
    String(decision.payload.planArtifactHash),
  )) as OperatingActionPlanV1;
  const effect = (await readJson(artifacts, plan.effectHash)) as SupervisedArtifactReviewV1;
  const journal = new SupervisionArtifactReviewJournal(
    events,
    artifacts,
    {
      ...authority,
      projectId: candidate.projectId,
      workstreamRevision: Number(candidate.payload.workstreamRevision),
      sessionId: candidate.sessionId,
      policyVersion: candidate.policyVersion,
    },
    () => candidate.occurredAt,
    null,
  );
  const observed = await journal.inspect(plan, effect);
  if (
    observed.status !== "confirmed" ||
    observed.eventIds[0] !== candidate.eventId ||
    operatingContractHash(plan) !== decision.payload.planHash
  )
    throw new Error("The owner review has no exact canonical effect evidence.");
  return { effect, candidate };
}

export async function observeSupervisedArtifactReview(
  input: Parameters<typeof readReview>[0] & {
    assignment: SupervisedAssignmentObservationV1;
  },
): Promise<SupervisedAssignmentObservationV1["review"]> {
  const observed = await readReview(input);
  if (observed === null) return null;
  const { effect, candidate } = observed;
  const { assignment } = input;
  if (
    effect.assignmentRevision !== assignment.revision ||
    effect.terminalEventId !== assignment.terminalEventId ||
    effect.responsibilityArtifactHash !== assignment.responsibilityArtifactHash
  )
    return null;
  assertSupervisedReviewBasis(effect, assignment);
  return {
    eventId: candidate.eventId,
    verdict: effect.verdict,
    reviewerAgentId: effect.reviewerAgentId,
    acceptanceHash: effect.acceptanceHash,
    artifactHashes: [...effect.artifactHashes],
    verificationEventIds: [...effect.verificationEventIds],
  };
}

/** Both owner replanning and the successor worker receive the exact recorded rejection rationale. */
export async function readSupervisedReviewFeedback(input: Parameters<typeof readReview>[0]) {
  const observed = await readReview(input);
  if (observed === null) throw new Error("The review feedback has no exact canonical verdict.");
  const rationale = await readJson(input.artifacts, observed.effect.rationaleArtifactHash);
  if (typeof rationale !== "string" || rationale.trim().length === 0)
    throw new Error("The review feedback rationale is unavailable.");
  return {
    assignmentId: observed.effect.assignmentId,
    reviewEventId: observed.candidate.eventId,
    verdict: observed.effect.verdict,
    rationale,
  };
}
