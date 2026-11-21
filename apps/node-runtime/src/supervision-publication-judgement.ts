import type {
  OperatingActionPlanV1,
  SupervisedOwnerReasoningV1,
  SupervisedResultDeliveryV2,
} from "@lervo/application-contract";
import type { ConversationReplyCandidate } from "@lervo/interaction";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import {
  managedExecutionIdentity,
  operatingContractHash,
  parseOwnerReasoningDecision,
} from "@lervo/work-controller";
import {
  readSupervisionJsonArtifact,
  readSupervisionTextArtifact,
} from "./supervision-artifact-json.js";
import { inspectOwnerReasoning } from "./supervision-reasoning-receipt.js";
import type { OwnerReasoningContext } from "./supervision-reasoning-context.js";
import { resultWritingContract } from "./conversation-result-publication.js";
import { boundResultDetails } from "./supervision-reasoning-references.js";

/** Checks the immutable native model evidence behind a publication permit, including retries. */
export async function assertNativePublicationJudgement(input: {
  events: EventStore;
  artifacts: ArtifactStore;
  effect: SupervisedResultDeliveryV2;
  completionPlan: OperatingActionPlanV1;
  candidate: ConversationReplyCandidate;
}) {
  const { effect, completionPlan, candidate } = input;
  const plan = (await readSupervisionJsonArtifact(
    input.artifacts,
    effect.reasoningPlanHash,
  )) as OperatingActionPlanV1;
  if (
    plan.effectContract !== "work.owner_reasoning.v1" ||
    ["projectId", "workstreamId", "supervisionId", "ownerAgentId", "mandateHash"].some(
      (key) =>
        plan[key as keyof OperatingActionPlanV1] !==
        completionPlan[key as keyof OperatingActionPlanV1],
    ) ||
    (await inspectOwnerReasoning(input, plan)).status !== "confirmed"
  )
    throw new Error("Native publication lacks a settled independent owner judgement.");
  const identity = managedExecutionIdentity(plan.projectId, effect.reasoningPlanHash);
  const terminal = collectRunEventsBounded({
    events: input.events,
    runId: identity.runId,
    maximumEvents: 4096,
  }).find((event) => event.type === "run.completed");
  if (terminal?.payload.resultDigest !== effect.reasoningResultHash)
    throw new Error("Native publication substituted its semantic model result.");
  const decision = parseOwnerReasoningDecision(
    await readSupervisionTextArtifact(input.artifacts, effect.reasoningResultHash),
  );
  const details = JSON.parse(decision.details) as Record<string, unknown>;
  const model = (await readSupervisionJsonArtifact(
    input.artifacts,
    plan.effectHash,
  )) as SupervisedOwnerReasoningV1;
  const context = (await readSupervisionJsonArtifact(
    input.artifacts,
    model.contextArtifactHash,
  )) as OwnerReasoningContext;
  const accepted = context.facts.acceptedGoal;
  const evaluation = candidate.publicationEvidence.evaluation;
  if (
    decision.operation !== "prepare_publication" ||
    !boundResultDetails(details, "checks,writingPolicyId", effect.resultArtifactHash) ||
    details.writingPolicyId !== resultWritingContract.writingPolicyId ||
    context.trigger.nextAction !== "publish_result" ||
    accepted?.completionPlanHash !== effect.completionPlanHash ||
    accepted.completionEventId !== effect.completionEventId ||
    accepted.resultArtifactHash !== effect.resultArtifactHash ||
    accepted.text !==
      (await readSupervisionTextArtifact(input.artifacts, effect.resultArtifactHash)) ||
    operatingContractHash(context.facts.resultWritingContract) !==
      operatingContractHash(resultWritingContract) ||
    operatingContractHash(
      evaluation.checks
        .filter((item) => item.kind === "semantic")
        .map(({ checkId, status, violationCount }) => ({ checkId, status, violationCount })),
    ) !== operatingContractHash(details.checks) ||
    !evaluation.evaluators.some(
      (item) =>
        item.kind === "model" &&
        item.evaluatorId === `lervo.native-owner.${effect.reasoningResultHash.slice(7, 31)}`,
    )
  )
    throw new Error(
      "The native publication permit differs from the accepted goal and exact semantic verdict.",
    );
}
