import { createHash } from "node:crypto";

import type { ConversationReplyCandidate } from "@lervo/interaction";
import type { ConversationInboundEvent } from "@lervo/schemas";
import {
  evaluateWritingPublication,
  readPublishableWritingArtifact,
  type WritingArtifactCoordinate,
} from "@lervo/writing";

import { parseConversationControlCommand } from "./parser.js";
import { createConversationControlResponse } from "./command-response.js";
import type { ConversationControlResponderOptions } from "./types.js";
import { ConversationControlError } from "./types.js";

function timestamp(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime())) {
    throw new ConversationControlError("control_command_invalid", "The conversation control time is invalid.");
  }
  return value.toISOString();
}

async function readMessage(options: ConversationControlResponderOptions,
  event: ConversationInboundEvent): Promise<string> {
  const uri = `lervo-cas://sha256/${event.content.contentHash.slice("sha256:".length)}`;
  try {
    const bytes = new Uint8Array(await options.artifactStore.get(uri));
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (bytes.byteLength !== event.content.byteCount || hash !== event.content.contentHash) {
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

async function storeWriting(options: ConversationControlResponderOptions,
  content: string): Promise<WritingArtifactCoordinate> {
  const bytes = Buffer.from(content, "utf8");
  const stored = await options.artifactStore.put(bytes);
  return {
    artifactId: `art_${stored.contentHash.slice("sha256:".length)}`,
    uri: stored.uri,
    mediaType: "text/markdown; charset=utf-8",
    contentHash: stored.contentHash,
    byteCount: stored.byteCount,
  };
}

export class ConversationControlResponder {
  private readonly now: () => Date;

  constructor(private readonly options: ConversationControlResponderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async respond(input: Parameters<import("@lervo/interaction").ConversationResponder["respond"]>[0]):
    Promise<ConversationReplyCandidate> {
    const parsed = parseConversationControlCommand(await readMessage(this.options, input.event));
    if (parsed === null) {
      throw new ConversationControlError(
        "control_command_invalid",
        "This is not an explicit Lervo control command.",
      );
    }
    const inspectedAt = timestamp(this.now);
    const artifact = await storeWriting(
      this.options,
      await createConversationControlResponse({
        options: this.options,
        event: input.event,
        command: parsed,
        at: inspectedAt,
      }),
    );
    const publication = await evaluateWritingPublication({
      artifact,
      contract: this.options.writingContract,
      surface: "chat",
      artifactStore: this.options.artifactStore,
      semanticEvaluator: this.options.semanticEvaluator,
    }, { now: this.now });
    if (publication.status !== "allowed") {
      throw new ConversationControlError(
        "writing_publication_blocked",
        "The Hub control response did not pass writing publication verification.",
      );
    }
    await readPublishableWritingArtifact({
      artifact,
      evaluation: publication.evaluation,
      evaluationArtifact: publication.evaluationArtifact,
      permit: publication.permit,
      contract: this.options.writingContract,
      surface: "chat",
      artifactStore: this.options.artifactStore,
    });
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
}
