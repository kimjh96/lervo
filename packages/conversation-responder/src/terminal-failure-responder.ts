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
    const reason = {
      response_context_unavailable: "저장소 맥락을 읽는 중 문제가 생겼습니다.",
      response_provider_unavailable: "응답 모델 연결을 완료하지 못했습니다.",
      response_storage_unavailable: "응답 증거를 안전하게 저장하지 못했습니다.",
      response_writing_blocked: "응답 문안이 게시 기준을 통과하지 못했습니다.",
      response_evaluation_unavailable: "응답 문안을 검토하지 못했습니다.",
      response_execution_invalid: "응답 실행 설정이 현재 정본과 맞지 않습니다.",
      response_contract_invalid: "요청을 안전한 응답 계약으로 처리하지 못했습니다.",
      publication_verification_failed: "완성된 응답의 게시 검증에 실패했습니다.",
      response_generation_failed: "응답 생성 중 예상하지 못한 문제가 생겼습니다.",
    }[input.failureCode];
    const content = `${reason} ${input.attemptCount}회 시도 후 종료했으며, 새 메시지는 계속 처리됩니다.`;
    const stored = await this.options.artifactStore.put(Buffer.from(content, "utf8"));
    const artifact = {
      artifactId: `art_${stored.contentHash.slice("sha256:".length)}`,
      uri: stored.uri,
      mediaType: "text/markdown; charset=utf-8" as const,
      contentHash: stored.contentHash,
      byteCount: stored.byteCount,
    };
    return {
      ...(await publishConversationResponse({
        artifact,
        artifactStore: this.options.artifactStore,
        writingContract: fixedConversationStatusWritingContract,
        maximumResponseCharacters: 2_000,
        ...(this.options.now === undefined ? {} : { now: this.options.now }),
      })),
      audienceParticipation: "observe_only",
    };
  }
}
