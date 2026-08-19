import {
  calculateDeliberationArtifactId,
  deliberationPolicyHash,
  validateDeliberationArtifact,
  validateDeliberationHistory,
  type DeliberationVerificationEvidence,
} from "@lervo/deliberation";
import type { ManagedProviderRunResult } from "@lervo/orchestrator";
import type {
  DeliberationArtifact,
  DeliberationArtifactKind,
  DeliberationPolicy,
  EventEnvelope,
  SharedContextPublication,
  WritingContract,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  evaluateWritingPublication,
  readPublishableWritingArtifact,
  type WritingSemanticEvaluator,
} from "@lervo/writing";
import { writingPolicyHash } from "@lervo/writing-contract";

import { validateManagedRunContextEvidence } from "./context-evidence-binding.js";
import {
  DeliberationRuntimeError,
  type DeliberationArtifactDetails,
} from "./types.js";

export async function publishDeliberationArtifact<K extends DeliberationArtifactKind>(input: {
  deliberationId: string;
  policy: DeliberationPolicy;
  round: number;
  kind: K;
  details: DeliberationArtifactDetails<K>;
  previousArtifacts: readonly DeliberationArtifact[];
  history: readonly DeliberationArtifact[];
  verificationEvidence: readonly DeliberationVerificationEvidence[];
  sharedContextPublications: readonly SharedContextPublication[];
  run: ManagedProviderRunResult;
  runEvents: readonly EventEnvelope[];
  writingContract: WritingContract;
  semanticEvaluator: WritingSemanticEvaluator;
  artifactStore: ArtifactStore;
  createdAt: string;
}): Promise<{ artifact: DeliberationArtifact; content: string }> {
  if (
    input.writingContract.writingPolicyId !== input.policy.publication.writingPolicyId ||
    writingPolicyHash(input.writingContract) !== input.policy.publication.writingPolicyHash
  ) {
    throw new DeliberationRuntimeError(
      "artifact_publication_failed",
      "writing_policy_mismatch",
      "숙의 정책과 writing 공개 정책이 다릅니다.",
    );
  }
  const publication = await evaluateWritingPublication({
    artifact: input.run.resultArtifact,
    contract: input.writingContract,
    surface: input.policy.publication.surface,
    artifactStore: input.artifactStore,
    semanticEvaluator: input.semanticEvaluator,
  }, { now: () => new Date(input.createdAt) });
  if (publication.status !== "allowed") {
    throw new DeliberationRuntimeError(
      "artifact_publication_failed",
      "writing_publication_blocked",
      "Writing 검증을 통과하지 못한 provider 결과는 숙의 artifact로 공개할 수 없습니다.",
    );
  }
  const content = await readPublishableWritingArtifact({
    artifact: input.run.resultArtifact,
    evaluation: publication.evaluation,
    evaluationArtifact: publication.evaluationArtifact,
    permit: publication.permit,
    contract: input.writingContract,
    surface: input.policy.publication.surface,
    artifactStore: input.artifactStore,
  });
  const contextEvidence = validateManagedRunContextEvidence({
    run: input.run,
    events: input.runEvents,
    previousArtifacts: input.previousArtifacts,
    sharedContextPublications: input.sharedContextPublications,
  });
  const { evidenceEventIds, ...inputContext } = contextEvidence;
  const withoutId = {
    schemaVersion: 1 as const,
    deliberationArtifactId: "dla_0000000000000000",
    deliberationId: input.deliberationId,
    projectId: input.policy.projectId,
    policyId: input.policy.policyId,
    policyHash: deliberationPolicyHash(input.policy),
    kind: input.kind,
    round: input.round,
    producer: {
      roleId: input.run.session.roleId,
      runId: input.run.session.runId,
      sessionId: input.run.session.sessionId,
      provider: input.run.session.provider,
    },
    content: input.run.resultArtifact,
    inputContext,
    previousArtifactIds: input.previousArtifacts.map((artifact) => artifact.deliberationArtifactId),
    evidenceEventIds,
    writingPublicationPermit: publication.permit,
    details: input.details,
    createdAt: input.createdAt,
  };
  const artifact = {
    ...withoutId,
    deliberationArtifactId: calculateDeliberationArtifactId(withoutId as DeliberationArtifact),
  } as DeliberationArtifact;
  try {
    validateDeliberationArtifact(artifact, input.policy);
    validateDeliberationHistory({
      policy: input.policy,
      artifacts: [...input.history, artifact],
      verificationEvidence: input.verificationEvidence,
    });
  } catch (error) {
    throw new DeliberationRuntimeError(
      "artifact_publication_failed",
      "artifact_history_invalid",
      "Provider 결과로 만든 숙의 artifact가 현재 이력 계약과 맞지 않습니다.",
      { cause: error },
    );
  }
  return { artifact, content };
}
