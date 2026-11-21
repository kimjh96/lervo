import { collectRunEventsBounded } from "@lervo/storage-contract";
import type {
  OperatingActionPlanV1,
  SupervisedAssignmentCompletion,
  SupervisedOwnerReasoningV1,
} from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  operatingContractHash,
  managedExecutionIdentity,
  parseOwnerReasoningDecision,
  supervisedAssignmentCompletionFields,
} from "@lervo/work-controller";
import {
  readPublishableWritingArtifact,
  type WritingArtifactCoordinate,
  type WritingPublicationResult,
} from "@lervo/writing";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import {
  readSupervisionJsonArtifact,
  readSupervisionTextArtifact,
} from "./supervision-artifact-json.js";
import { inspectOwnerReasoning } from "./supervision-reasoning-receipt.js";
import { boundResultDetails } from "./supervision-reasoning-references.js";
import { prepareSupervisionResearchEvaluation } from "./supervision-research-evaluation.js";
import { readSupervisionResearchEvidence } from "./supervision-research-evidence.js";
import {
  assertOwnerReasoningContext,
  type OwnerReasoningContext,
} from "./supervision-reasoning-context.js";

export async function readAssignmentCompletionEffect(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const effect = (await readSupervisionJsonArtifact(
    storage.artifacts,
    plan.effectHash,
  )) as SupervisedAssignmentCompletion;
  const fields = supervisedAssignmentCompletionFields(effect);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    )
  )
    throw new Error("The assignment completion differs from its exact effect.");
  const reasoningPlan = (await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.reasoningPlanHash,
  )) as OperatingActionPlanV1;
  if (
    reasoningPlan.effectContract !== "work.owner_reasoning.v1" ||
    ["projectId", "workstreamId", "supervisionId", "ownerAgentId", "mandateHash"].some(
      (key) =>
        reasoningPlan[key as keyof OperatingActionPlanV1] !==
        plan[key as keyof OperatingActionPlanV1],
    ) ||
    (await inspectOwnerReasoning(storage, reasoningPlan)).status !== "confirmed"
  )
    throw new Error("The completion has no settled independent native semantic judgement.");
  const identity = managedExecutionIdentity(plan.projectId, effect.reasoningPlanHash);
  const terminal = collectRunEventsBounded({
    events: storage.events,
    runId: identity.runId,
    maximumEvents: 4096,
  }).find((event) => event.type === "run.completed");
  if (terminal?.payload.resultDigest !== effect.reasoningResultHash)
    throw new Error("The completion semantic result differs from the native run.");
  const decision = parseOwnerReasoningDecision(
    await readSupervisionTextArtifact(storage.artifacts, effect.reasoningResultHash),
  );
  const details = JSON.parse(decision.details) as Record<string, unknown>;
  const writing = (await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.writingArtifactHash,
  )) as { artifact: WritingArtifactCoordinate; publication: WritingPublicationResult };
  const modelEffect = (await readSupervisionJsonArtifact(
    storage.artifacts,
    reasoningPlan.effectHash,
  )) as SupervisedOwnerReasoningV1;
  const context = (await readSupervisionJsonArtifact(
    storage.artifacts,
    modelEffect.contextArtifactHash,
  )) as OwnerReasoningContext;
  const roleEvaluationHash = effect.schemaVersion === 1 ? null : effect.roleEvaluationArtifactHash;
  if (
    decision.operation !== "prepare_completion" ||
    details.assignmentId !== effect.responsibility.assignmentId ||
    !boundResultDetails(
      details,
      roleEvaluationHash !== null
        ? "assignmentId,checks,researchChecks,writingPolicyId"
        : "assignmentId,checks,writingPolicyId",
      writing.artifact.contentHash,
    ) ||
    details.writingPolicyId !== context.facts.writingContract.writingPolicyId ||
    writing.publication.status !== "allowed" ||
    writing.publication.semanticEvaluationStatus !== "completed" ||
    operatingContractHash(
      writing.publication.evaluation.checks
        .filter((item) => item.kind === "semantic")
        .map(({ checkId, status, violationCount }) => ({ checkId, status, violationCount })),
    ) !== operatingContractHash(details.checks) ||
    !writing.publication.evaluation.evaluators.some(
      (item) =>
        item.kind === "model" &&
        item.evaluatorId === `lervo.native-owner.${effect.reasoningResultHash.slice(7, 31)}`,
    )
  )
    throw new Error("The completion writing permit differs from its exact native verdict.");
  await readPublishableWritingArtifact({
    artifact: writing.artifact,
    ...writing.publication,
    contract: context.facts.writingContract,
    surface: "chat",
    artifactStore: storage.artifacts,
  });
  const research = prepareSupervisionResearchEvaluation({
    facts: context.facts,
    assignmentId: effect.responsibility.assignmentId,
    details,
    projectId: plan.projectId,
    reasoningPlanHash: effect.reasoningPlanHash,
    reasoningResultHash: effect.reasoningResultHash,
    content: await readSupervisionTextArtifact(storage.artifacts, writing.artifact.contentHash),
    evaluatedAt: effect.preparedAt,
  });
  if (
    research === null
      ? roleEvaluationHash !== null
      : roleEvaluationHash === null || research.overallStatus !== "passed"
  )
    throw new Error("The completion is missing its independently passed role evaluation.");
  if (roleEvaluationHash !== null) {
    const actual = context.facts.tasks.assignments.find(
      (item) => item.assignmentId === effect.responsibility.assignmentId,
    );
    if (actual?.terminalEventId === null || actual === undefined)
      throw new Error("The research evaluation has no exact producer terminal event.");
    const evidence = await readSupervisionResearchEvidence({
      storage,
      responsibility: effect.responsibility,
      terminalEventId: actual.terminalEventId,
    });
    if (
      operatingContractHash(evidence) !==
        operatingContractHash(
          context.facts.researchEvidence.find(
            (item) => item.assignmentId === effect.responsibility.assignmentId,
          ),
        ) ||
      operatingContractHash(research) !==
        operatingContractHash(
          await readSupervisionJsonArtifact(storage.artifacts, roleEvaluationHash),
        )
    )
      throw new Error(
        "The role evaluation differs from its canonical producer and independent verdict.",
      );
  }
  const rationale = await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.rationaleArtifactHash,
  );
  if (typeof rationale !== "string" || !rationale.trim())
    throw new Error("The completion rationale is unavailable.");
  return { effect, fields, writing, context, modelEffect };
}

export async function readCanonicalAssignmentCompletion(input: {
  storage: ProjectStorage;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  now(): string;
}) {
  const basis = await readAssignmentCompletionEffect(input.storage, input.plan);
  await assertOwnerReasoningContext({
    ...input,
    context: basis.context,
    basisHash: basis.modelEffect.basisHash,
  });
  const assignment = input.source.assignments.find(
    (item) => item.assignmentId === basis.effect.responsibility.assignmentId,
  );
  const task = basis.effect.responsibility;
  const actual = basis.context.facts.tasks.assignments.find(
    (item) => item.assignmentId === task.assignmentId,
  );
  const leaseEvidenceAt =
    basis.effect.schemaVersion === 3 ? basis.effect.executionCompletedAt : basis.effect.preparedAt;
  if (
    assignment?.status !== "leased" ||
    assignment.lease === null ||
    operatingContractHash(assignment) !== basis.effect.expectedAssignmentHash ||
    assignment.revision !== task.assignmentRevision ||
    assignment.assigneeAgentId !== task.executorAgentId ||
    input.source.responsibilities.find((item) => item.assignmentId === task.assignmentId)?.binding
      ?.responsibilityHash !== basis.fields.responsibilityArtifactHash ||
    Date.parse(leaseEvidenceAt) < Date.parse(assignment.lease.acquiredAt) ||
    Date.parse(leaseEvidenceAt) >= Date.parse(assignment.lease.expiresAt) ||
    Date.parse(basis.effect.preparedAt) > Date.parse(input.now()) ||
    actual?.effectDisposition !== "reconciled" ||
    actual.artifactHashes.length !== 1 ||
    actual.artifactHashes[0] !== basis.writing.artifact.contentHash ||
    task.verificationSuiteIds.some(
      (suite) =>
        !actual.verification.some((item) => item.suiteId === suite && item.status === "passed"),
    )
  )
    throw new Error("The assignment completion basis or exact prepared lease is unavailable.");
  const terminal = input.source.events.find((event) => event.eventId === actual.terminalEventId);
  if (
    terminal?.type !== "run.completed" ||
    terminal.payload.verificationStatus !== "passed" ||
    !(terminal.payload.artifactIds as string[]).includes(basis.writing.artifact.artifactId) ||
    Date.parse(basis.effect.preparedAt) < Date.parse(terminal.occurredAt) ||
    (basis.effect.schemaVersion === 3 &&
      (terminal.eventId !== basis.effect.terminalEventId ||
        terminal.occurredAt !== basis.effect.executionCompletedAt ||
        Date.parse(terminal.occurredAt) >= Date.parse(task.completionDeadline)))
  )
    throw new Error("The completed result is not the verified managed task result.");
  return { ...basis, assignment, terminal };
}
