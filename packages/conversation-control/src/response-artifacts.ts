import { createHash } from "node:crypto";

import type { ConversationReplyCandidate } from "@lervo/interaction";
import type { ConversationInboundEvent, WritingContract } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  evaluateWritingPublication,
  readPublishableWritingArtifact,
  type WritingArtifactCoordinate,
  type WritingSemanticEvaluator,
} from "@lervo/writing";

import { ConversationControlError } from "./types.js";

export async function readConversationControlMessage(input: {
  artifactStore: ArtifactStore;
  event: ConversationInboundEvent;
}): Promise<string> {
  const uri = `lervo-cas://sha256/${input.event.content.contentHash.slice("sha256:".length)}`;
  try {
    const bytes = new Uint8Array(await input.artifactStore.get(uri));
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (
      bytes.byteLength !== input.event.content.byteCount ||
      hash !== input.event.content.contentHash
    ) {
      throw new Error("message artifact mismatch");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ConversationControlError(
      "message_artifact_invalid",
      "Could not read the control command source safely.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function storeWriting(
  artifactStore: ArtifactStore,
  content: string,
): Promise<WritingArtifactCoordinate> {
  const bytes = Buffer.from(content, "utf8");
  const stored = await artifactStore.put(bytes);
  return {
    artifactId: `art_${stored.contentHash.slice("sha256:".length)}`,
    uri: stored.uri,
    mediaType: "text/markdown; charset=utf-8",
    contentHash: stored.contentHash,
    byteCount: stored.byteCount,
  };
}

export async function createVerifiedConversationControlReply(input: {
  artifactStore: ArtifactStore;
  writingContract: WritingContract;
  semanticEvaluator?: WritingSemanticEvaluator;
  content: string;
  now?: () => Date;
}): Promise<ConversationReplyCandidate> {
  const artifact = await storeWriting(input.artifactStore, input.content);
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
    throw new ConversationControlError(
      "writing_publication_blocked",
      "The conversation response did not pass writing publication verification.",
    );
  }
  await readPublishableWritingArtifact({
    artifact,
    evaluation: publication.evaluation,
    evaluationArtifact: publication.evaluationArtifact,
    permit: publication.permit,
    contract: input.writingContract,
    surface: "chat",
    artifactStore: input.artifactStore,
  });
  return {
    content: {
      artifactId: artifact.artifactId,
      contentHash: artifact.contentHash,
      byteCount: artifact.byteCount,
      mediaType: artifact.mediaType,
    },
    publicationPermit: publication.permit,
    audienceParticipation: "observe_only",
    publicationEvidence: {
      artifact,
      evaluation: publication.evaluation,
      evaluationArtifact: publication.evaluationArtifact,
    },
  };
}
