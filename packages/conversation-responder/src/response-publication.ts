import type { ConversationReplyCandidate } from "@lervo/interaction";
import type { ManagedProviderRunResult } from "@lervo/execution-contract";
import type { WritingContract } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  evaluateWritingPublication,
  readPublishableWritingArtifact,
  type WritingSemanticEvaluator,
} from "@lervo/writing";

import { ManagedConversationResponseError } from "./types.js";

export async function publishConversationResponse(input: {
  run: ManagedProviderRunResult;
  writingContract: WritingContract;
  artifactStore: ArtifactStore;
  semanticEvaluator: WritingSemanticEvaluator;
  now?: () => Date;
}): Promise<ConversationReplyCandidate> {
  if (input.run.resultArtifact.byteCount > 65_536) {
    throw new ManagedConversationResponseError(
      "writing_publication_blocked",
      "The conversation response exceeds the maximum publishable size.",
    );
  }
  const publication = await evaluateWritingPublication({
    artifact: input.run.resultArtifact,
    contract: input.writingContract,
    surface: "chat",
    artifactStore: input.artifactStore,
    semanticEvaluator: input.semanticEvaluator,
  }, input.now === undefined ? {} : { now: input.now });
  if (publication.status !== "allowed") {
    throw new ManagedConversationResponseError(
      "writing_publication_blocked",
      "A provider result that fails writing verification cannot be published to a conversation.",
    );
  }
  await readPublishableWritingArtifact({
    artifact: input.run.resultArtifact,
    evaluation: publication.evaluation,
    evaluationArtifact: publication.evaluationArtifact,
    permit: publication.permit,
    contract: input.writingContract,
    surface: "chat",
    artifactStore: input.artifactStore,
  });
  return {
    content: {
      artifactId: input.run.resultArtifact.artifactId,
      contentHash: input.run.resultArtifact.contentHash,
      byteCount: input.run.resultArtifact.byteCount,
      mediaType: input.run.resultArtifact.mediaType,
    },
    publicationPermit: publication.permit,
    publicationEvidence: {
      artifact: input.run.resultArtifact,
      evaluation: publication.evaluation,
      evaluationArtifact: publication.evaluationArtifact,
    },
  };
}
