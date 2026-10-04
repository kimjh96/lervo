import type { ConversationReplyCandidate } from "@lervo/interaction";
import type { WritingContract } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  evaluateWritingPublication,
  readPublishableWritingArtifact,
  repairProviderClaimArtifact,
  type ProviderClaimContext,
  type WritingArtifactCoordinate,
  type WritingSemanticEvaluator,
} from "@lervo/writing";

import { ManagedConversationResponseError } from "./types.js";

/** The provider-claim context of one generated reply; only the producing provider is observed. */
export function generatedReplyProviderClaim(input: {
  provider: string;
  verifiedDeliberation?: (deliberationId: string) => boolean | Promise<boolean>;
}): ProviderClaimContext {
  return {
    observedProvider:
      input.provider === "codex" || input.provider === "claude" ? input.provider : null,
    ...(input.verifiedDeliberation === undefined
      ? {}
      : { isVerifiedDeliberation: input.verifiedDeliberation }),
  };
}

export async function publishConversationResponse(input: {
  artifact: WritingArtifactCoordinate;
  writingContract: WritingContract;
  artifactStore: ArtifactStore;
  semanticEvaluator?: WritingSemanticEvaluator;
  maximumResponseCharacters?: number;
  now?: () => Date;
  /** ADR-0460: repairs an unproven multi-provider opinion claim before evaluation. */
  providerClaim?: ProviderClaimContext;
}): Promise<ConversationReplyCandidate> {
  if (input.artifact.byteCount > 65_536) {
    throw new ManagedConversationResponseError(
      "writing_publication_blocked",
      "The conversation response exceeds the maximum publishable size.",
    );
  }
  const artifact =
    input.providerClaim === undefined
      ? input.artifact
      : (
          await repairProviderClaimArtifact({
            artifactStore: input.artifactStore,
            artifact: input.artifact,
            context: input.providerClaim,
          })
        ).artifact;
  const publication = await evaluateWritingPublication(
    {
      artifact,
      contract: input.writingContract,
      surface: "chat",
      artifactStore: input.artifactStore,
      ...(input.semanticEvaluator === undefined
        ? {}
        : { semanticEvaluator: input.semanticEvaluator }),
    },
    input.now === undefined ? {} : { now: input.now },
  );
  if (publication.status !== "allowed") {
    if (
      input.writingContract.verification.semanticChecks.some((check) => check.required) &&
      publication.semanticEvaluationStatus !== "completed"
    ) {
      throw new ManagedConversationResponseError(
        "writing_evaluation_unavailable",
        "The conversation response semantic writing evaluation was unavailable or invalid.",
      );
    }
    throw new ManagedConversationResponseError(
      "writing_publication_blocked",
      "A provider result that fails writing verification cannot be published to a conversation.",
    );
  }
  const content = await readPublishableWritingArtifact({
    artifact,
    evaluation: publication.evaluation,
    evaluationArtifact: publication.evaluationArtifact,
    permit: publication.permit,
    contract: input.writingContract,
    surface: "chat",
    artifactStore: input.artifactStore,
  });
  if ([...content].length > (input.maximumResponseCharacters ?? 65_536)) {
    throw new ManagedConversationResponseError(
      "writing_publication_blocked",
      "The conversation response exceeds the channel character limit.",
    );
  }
  return {
    content: {
      artifactId: artifact.artifactId,
      contentHash: artifact.contentHash,
      byteCount: artifact.byteCount,
      mediaType: artifact.mediaType,
    },
    publicationPermit: publication.permit,
    publicationEvidence: {
      artifact,
      evaluation: publication.evaluation,
      evaluationArtifact: publication.evaluationArtifact,
    },
  };
}
