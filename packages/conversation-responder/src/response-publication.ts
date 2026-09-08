import type { ConversationReplyCandidate } from "@lervo/interaction";
import type { WritingContract } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  evaluateWritingPublication,
  readPublishableWritingArtifact,
  type WritingArtifactCoordinate,
  type WritingSemanticEvaluator,
} from "@lervo/writing";

import { ManagedConversationResponseError } from "./types.js";

export async function publishConversationResponse(input: {
  artifact: WritingArtifactCoordinate;
  writingContract: WritingContract;
  artifactStore: ArtifactStore;
  semanticEvaluator?: WritingSemanticEvaluator;
  maximumResponseCharacters?: number;
  now?: () => Date;
}): Promise<ConversationReplyCandidate> {
  if (input.artifact.byteCount > 65_536) {
    throw new ManagedConversationResponseError(
      "writing_publication_blocked",
      "The conversation response exceeds the maximum publishable size.",
    );
  }
  const publication = await evaluateWritingPublication(
    {
      artifact: input.artifact,
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
    artifact: input.artifact,
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
      artifactId: input.artifact.artifactId,
      contentHash: input.artifact.contentHash,
      byteCount: input.artifact.byteCount,
      mediaType: input.artifact.mediaType,
    },
    publicationPermit: publication.permit,
    publicationEvidence: {
      artifact: input.artifact,
      evaluation: publication.evaluation,
      evaluationArtifact: publication.evaluationArtifact,
    },
  };
}
