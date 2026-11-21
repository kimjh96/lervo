import { nativeResultPublication } from "./supervision-native-publication.js";
import { nativeScopedHandoff } from "./supervision-native-handoff.js";
import {
  invalidNativeOwnerProposal,
  nativeOwnerAttention,
} from "./supervision-native-attention.js";
import type {
  ScopedWorkHandoffV1,
  ScopedWorkHandoffAcceptanceV1,
} from "@lervo/application-contract";
import type { SupervisedResultDeliveryV2 } from "@lervo/application-contract";
import type { NodeSupervisionResultDeliveryConfiguration } from "./supervision-result-delivery.js";
import type { SupervisedAssignmentAmendmentV1 } from "@lervo/application-contract";
import { nativeResponsibilityRevision } from "./supervision-native-revision.js";
import type { SupervisedResponsibilityClaimV1 } from "@lervo/application-contract";
import { nativeAssignmentRecovery } from "./supervision-native-recovery.js";
import type { SupervisedAssignmentRecovery } from "@lervo/application-contract";
import { nativeWorkerHire } from "./supervision-native-hire.js";
import { nativeAssignmentCompletion } from "./supervision-native-completion.js";
import type {
  OperatingActionPlanV1,
  OwnerReasoningDecisionV1,
  SupervisedOwnerAttentionV1,
  SupervisedArtifactReviewV1,
  SupervisedGoalCompletionV1,
  AutomaticTopologyEffectV1,
  SupervisedAssignmentCompletion,
  SupervisedWorkerHireV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { readBoundWorkstreamState } from "./supervision-workstream-state.js";
import {
  automaticTopologyEffectFields,
  classifyOwnerEscalationDetails,
  operatingContractHash,
  supervisedArtifactReviewFields,
  supervisedGoalCompletionFields,
  validOwnerHandoffAcceptanceDetails,
} from "@lervo/work-controller";
import { nativeAllocation } from "./supervision-native-allocation.js";
import { bindOwnerDecisionReferences } from "./supervision-reasoning-references.js";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";
import type { canonicalOwnerReasoningFacts } from "./supervision-reasoning-context.js";

type Facts = Awaited<ReturnType<typeof canonicalOwnerReasoningFacts>>["facts"];
export interface NativeOwnerPlanInput {
  storage: ProjectStorage;
  facts: Facts;
  decision: OwnerReasoningDecisionV1;
  base: OperatingActionPlanV1;
  reasoningPlanHash: string;
  resultArtifactHash: string;
  readiness: NodeRuntimeReadinessConfiguration;
  publicationOrigin?: NodeSupervisionResultDeliveryConfiguration["origin"];
  now(): string;
}

export async function materializeNativeOwnerProposal(
  input: NativeOwnerPlanInput,
): Promise<OperatingActionPlanV1> {
  const { decision, storage, facts, base } = input;
  const details = JSON.parse(decision.details) as Record<string, unknown>;
  let rationaleArtifactHash = (
    await storage.artifacts.put(
      canonicalJson(
        `${decision.rationale}\nReasoning decision: ${input.reasoningPlanHash}\nReasoning result: ${input.resultArtifactHash}`,
      ),
    )
  ).contentHash;
  let effect:
    | SupervisedOwnerAttentionV1
    | ScopedWorkHandoffV1
    | ScopedWorkHandoffAcceptanceV1
    | SupervisedResultDeliveryV2
    | SupervisedArtifactReviewV1
    | SupervisedGoalCompletionV1
    | AutomaticTopologyEffectV1
    | SupervisedAssignmentCompletion
    | SupervisedWorkerHireV1
    | SupervisedAssignmentAmendmentV1
    | SupervisedAssignmentRecovery
    | SupervisedResponsibilityClaimV1;
  let fields: Partial<OperatingActionPlanV1>;
  // ADR-0608: handoff and evidence references become exact hashes; an unknown one is refused.
  const bound = bindOwnerDecisionReferences(decision.operation, details, facts);
  if (decision.operation === "escalate" || decision.operation === "request_team_support") {
    const selected =
      bound === null ? { kind: "invalid" as const } : classifyOwnerEscalationDetails(bound);
    if (decision.operation === "escalate" && selected.kind === "attention") {
      ({ effect, fields } = nativeOwnerAttention(base, selected.reasonCode, rationaleArtifactHash));
    } else if (selected.kind === "handoff" && bound !== null) {
      const handoff = await nativeScopedHandoff(input, bound, rationaleArtifactHash);
      effect = handoff.effect;
      fields = handoff.fields;
    } else {
      ({ effect, fields, rationaleArtifactHash } = await invalidNativeOwnerProposal({
        artifacts: storage.artifacts,
        base,
        decision,
        reasoningPlanHash: input.reasoningPlanHash,
        resultArtifactHash: input.resultArtifactHash,
      }));
    }
  } else if (decision.operation === "accept_team_support") {
    if (bound !== null && validOwnerHandoffAcceptanceDetails(bound)) {
      const handoff = await nativeScopedHandoff(input, bound, rationaleArtifactHash);
      effect = handoff.effect;
      fields = handoff.fields;
    } else {
      ({ effect, fields, rationaleArtifactHash } = await invalidNativeOwnerProposal({
        artifacts: storage.artifacts,
        base,
        decision,
        reasoningPlanHash: input.reasoningPlanHash,
        resultArtifactHash: input.resultArtifactHash,
      }));
    }
  } else if (decision.operation === "prepare_publication") {
    const publication = await nativeResultPublication(input, details, rationaleArtifactHash);
    effect = publication.effect;
    fields = publication.fields;
  } else if (decision.operation === "revise_responsibility") {
    const revision = await nativeResponsibilityRevision(input, details, rationaleArtifactHash);
    effect = revision.effect;
    fields = revision.fields;
    rationaleArtifactHash = revision.rationaleArtifactHash;
  } else if (decision.operation === "request_rework" || decision.operation === "retry_attempt") {
    const recovery = await nativeAssignmentRecovery(input, details, rationaleArtifactHash);
    effect = recovery.effect;
    fields = recovery.fields;
  } else if (decision.operation === "prepare_completion") {
    const completion = await nativeAssignmentCompletion(input, details, rationaleArtifactHash);
    effect = completion.effect;
    fields = completion.fields;
    rationaleArtifactHash = completion.effect.rationaleArtifactHash;
  } else if (decision.operation === "review_artifacts") {
    if (
      Object.keys(details).length !== 2 ||
      typeof details.assignmentId !== "string" ||
      !["accepted", "rework", "blocked"].includes(String(details.verdict))
    )
      throw new Error("Owner review details must identify one current assignment and verdict.");
    const task = facts.tasks.assignments.find((item) => item.assignmentId === details.assignmentId);
    if (task === undefined || task.terminalEventId === null)
      throw new Error("The owner proposed a review without terminal task evidence.");
    effect = {
      schemaVersion: 1,
      kind: "work.artifact_review",
      assignmentId: task.assignmentId,
      assignmentRevision: task.revision,
      terminalEventId: task.terminalEventId,
      reviewerAgentId: base.ownerAgentId,
      responsibilityArtifactHash: task.responsibilityArtifactHash,
      acceptanceHash: task.acceptanceHash,
      artifactHashes: [...task.artifactHashes],
      verificationEventIds: task.verification.map((item) => item.eventId),
      verdict: details.verdict as SupervisedArtifactReviewV1["verdict"],
      rationaleArtifactHash,
    };
    fields = supervisedArtifactReviewFields(effect);
  } else if (decision.operation === "complete_workstream") {
    if (
      Object.keys(details).length !== 1 ||
      typeof details.result !== "string" ||
      details.result.trim().length === 0 ||
      details.result.length > 32768
    )
      throw new Error("The owner completion proposal requires one bounded contextual result.");
    if (
      facts.tasks.unboundAssignmentIds.length > 0 ||
      facts.tasks.assignments.length === 0 ||
      facts.tasks.assignments.some(
        (item) => item.review?.verdict !== "accepted" || item.review.eventId === undefined,
      )
    )
      throw new Error("The owner cannot complete a goal with unaccepted or unbound work.");
    const result = await storage.artifacts.put(details.result);
    const current = await readBoundWorkstreamState(storage, base.workstreamId);
    if (
      current === null ||
      operatingContractHash(current.snapshot) !== operatingContractHash(facts.workstream)
    )
      throw new Error("The canonical goal changed while preparing owner completion.");
    effect = {
      schemaVersion: 1,
      kind: "work.goal_completion",
      workstreamId: base.workstreamId,
      workstreamRevision: facts.workstream.revision,
      workstreamSnapshotHash: current.contentHash,
      ownerAgentId: base.ownerAgentId,
      assignmentReviews: facts.tasks.assignments.map((item) => ({
        assignmentId: item.assignmentId,
        assignmentRevision: item.revision,
        reviewEventId: item.review!.eventId!,
      })),
      resultArtifactHash: result.contentHash,
      rationaleArtifactHash,
      completedAt: input.now(),
    };
    fields = supervisedGoalCompletionFields(effect);
  } else if (decision.operation === "hire_worker") {
    const hire = await nativeWorkerHire(input, details, rationaleArtifactHash);
    effect = hire.effect;
    fields = hire.fields;
    rationaleArtifactHash = hire.rationaleArtifactHash;
  } else if (decision.operation === "allocate_existing") {
    const allocation = await nativeAllocation(input, details, rationaleArtifactHash);
    effect = allocation.effect;
    fields = automaticTopologyEffectFields(effect);
    rationaleArtifactHash = allocation.rationaleArtifactHash;
  } else
    throw new Error(
      `The owner proposal requires an unavailable concrete effect: ${decision.operation}.`,
    );
  await storage.artifacts.put(canonicalJson(effect));
  return { ...base, ...fields, rationaleArtifactHash };
}
