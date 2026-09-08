import { fixedConversationStatusWritingContract } from "@lervo/core";
import type {
  ConversationReplyCandidate,
  ConversationTerminalFailureResponder,
} from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";

import { publishConversationResponse } from "./response-publication.js";

export class FixedConversationTerminalFailureResponder implements ConversationTerminalFailureResponder {
  constructor(
    private readonly options: {
      artifactStore: ArtifactStore;
      now?: () => Date;
    },
  ) {}

  async respond(
    input: Parameters<ConversationTerminalFailureResponder["respond"]>[0],
  ): Promise<ConversationReplyCandidate> {
    const content =
      `요청에 대한 응답을 완료하지 못해 ${input.attemptCount}회 시도 후 종료했습니다. ` +
      "새 메시지는 계속 처리됩니다. 잠시 후 다시 말씀해 주세요.";
    const stored = await this.options.artifactStore.put(Buffer.from(content, "utf8"));
    const artifact = {
      artifactId: `art_${stored.contentHash.slice("sha256:".length)}`,
      uri: stored.uri,
      mediaType: "text/markdown; charset=utf-8" as const,
      contentHash: stored.contentHash,
      byteCount: stored.byteCount,
    };
    return publishConversationResponse({
      artifact,
      artifactStore: this.options.artifactStore,
      writingContract: fixedConversationStatusWritingContract,
      maximumResponseCharacters: 2_000,
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
    });
  }
}
