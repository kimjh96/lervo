import type {
  SupervisedAssignmentCompletion,
  SupervisedArtifactReviewV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import {
  operatingContractHash,
  supervisedAssignmentCompletionFields,
  supervisedArtifactReviewFields,
} from "@lervo/work-controller";
import { evaluateWritingPublication, type SemanticWritingEvaluationResponse } from "@lervo/writing";
import type { NativeOwnerPlanInput } from "./supervision-native-plans.js";
import { prepareSupervisionResearchEvaluation } from "./supervision-research-evaluation.js";
import {
  readSupervisionJsonArtifact,
  readSupervisionTextArtifact,
} from "./supervision-artifact-json.js";

/** Converts an independent native semantic verdict into a separately admitted completion proposal. */
export async function nativeAssignmentCompletion(
  input: NativeOwnerPlanInput,
  details: Record<string, unknown>,
  rationaleArtifactHash: string,
) {
  const task = input.facts.tasks.assignments.find(
    (item) => item.assignmentId === details.assignmentId,
  );
  const assignment = input.facts.assignments.find(
    (item) => item.assignmentId === details.assignmentId,
  );
  const binding = input.facts.responsibilities.find(
    (item) => item.assignmentId === details.assignmentId,
  )?.binding;
  const policy = input.facts.writingContract;
  const researchRequired =
    input.facts.roles
      .find((item) => item.roleId === assignment?.roleId)
      ?.profile.contextPolicy.requiredDocumentRuleIds.includes("research.source-policy") === true;
  if (
    Object.keys(details).sort().join(",") !==
      (researchRequired
        ? "assignmentId,checks,researchChecks,resultContentHash,writingPolicyId"
        : "assignmentId,checks,resultContentHash,writingPolicyId") ||
    task?.terminalEventId === null ||
    task === undefined ||
    assignment?.status !== "leased" ||
    assignment.lease === null ||
    binding === undefined ||
    binding === null ||
    task.artifactHashes.length !== 1 ||
    details.resultContentHash !== task.artifactHashes[0] ||
    details.writingPolicyId !== policy.writingPolicyId ||
    !Array.isArray(details.checks) ||
    details.checks.length !==
      policy.verification.semanticChecks.filter((item) => item.required).length
  )
    throw new Error(
      "The native completion verdict differs from the returned task and writing policy.",
    );
  const contentHash = task.artifactHashes[0]!;
  const content = await readSupervisionTextArtifact(input.storage.artifacts, contentHash);
  const preparedAt = input.now();
  const research = prepareSupervisionResearchEvaluation({
    facts: input.facts,
    assignmentId: task.assignmentId,
    details,
    projectId: input.base.projectId,
    reasoningPlanHash: input.reasoningPlanHash,
    reasoningResultHash: input.resultArtifactHash,
    content,
    evaluatedAt: preparedAt,
  });
  const artifact = {
    artifactId: `art_${contentHash.slice(7)}`,
    uri: `lervo-cas://sha256/${contentHash.slice(7)}`,
    contentHash,
    byteCount: Buffer.byteLength(content),
    mediaType: "text/markdown; charset=utf-8" as const,
  };
  const checks = details.checks as SemanticWritingEvaluationResponse["checks"];
  if (
    checks.some((check) => Object.keys(check).sort().join(",") !== "checkId,status,violationCount")
  )
    throw new Error("The native completion semantic check shape is invalid.");
  const publication = await evaluateWritingPublication(
    {
      artifact,
      contract: policy,
      surface: "chat",
      artifactStore: input.storage.artifacts,
      semanticEvaluator: {
        evaluate: async (request) => {
          if (
            request.contentHash !== contentHash ||
            request.content !== content ||
            request.writingPolicyId !== details.writingPolicyId
          )
            throw new Error("The semantic writing request differs from its native judgement.");
          return {
            evaluator: {
              kind: "model",
              evaluatorId: `lervo.native-owner.${input.resultArtifactHash.slice(7, 31)}`,
            },
            checks,
          };
        },
      },
    },
    { now: () => new Date(input.now()) },
  );
  if (publication.semanticEvaluationStatus !== "completed")
    throw new Error("The returned task has no completed independent writing judgement.");
  if (
    publication.status !== "allowed" ||
    (research !== null && research.overallStatus !== "passed")
  ) {
    const judgement = await readSupervisionJsonArtifact(
      input.storage.artifacts,
      rationaleArtifactHash,
    );
    if (typeof judgement !== "string" || judgement.trim().length === 0)
      throw new Error("The rejected writing judgement has no recorded rationale.");
    const rationale = await input.storage.artifacts.put(
      canonicalJson(
        `The independent artifact judgement rejected this exact returned result. Correct the recorded findings before acceptance.\n${judgement}\n${JSON.stringify(checks)}\n${research === null ? "" : JSON.stringify(research)}\nReasoning decision: ${input.reasoningPlanHash}\nReasoning result: ${input.resultArtifactHash}`,
      ),
    );
    const effect: SupervisedArtifactReviewV1 = {
      schemaVersion: 1,
      kind: "work.artifact_review",
      assignmentId: task.assignmentId,
      assignmentRevision: task.revision,
      terminalEventId: task.terminalEventId,
      reviewerAgentId: input.base.ownerAgentId,
      responsibilityArtifactHash: task.responsibilityArtifactHash,
      acceptanceHash: task.acceptanceHash,
      artifactHashes: [...task.artifactHashes],
      verificationEventIds: task.verification.map((item) => item.eventId),
      verdict: "rework",
      rationaleArtifactHash: rationale.contentHash,
    };
    return { effect, fields: supervisedArtifactReviewFields(effect) };
  }
  const writing = await input.storage.artifacts.put(canonicalJson({ artifact, publication }));
  const effect: SupervisedAssignmentCompletion = {
    ...(research === null
      ? { schemaVersion: 1 as const }
      : {
          schemaVersion: 2 as const,
          roleEvaluationArtifactHash: (await input.storage.artifacts.put(canonicalJson(research)))
            .contentHash,
        }),
    kind: "work.assignment_completion",
    responsibility: binding.responsibility,
    expectedAssignmentHash: operatingContractHash(assignment),
    writingArtifactHash: writing.contentHash,
    reasoningPlanHash: input.reasoningPlanHash,
    reasoningResultHash: input.resultArtifactHash,
    preparedAt,
    rationaleArtifactHash,
  };
  return { effect, fields: supervisedAssignmentCompletionFields(effect) };
}
