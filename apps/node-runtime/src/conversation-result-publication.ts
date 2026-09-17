import {
  assertConversationOutboundMessage,
  calculateConversationOutboundId,
} from "@lervo/conversation-contract";
import { createVerifiedConversationControlReply } from "@lervo/conversation-control";
import {
  adaptiveConversationWritingContract,
  fixedConversationStatusWritingContract,
} from "@lervo/core";
import type { ConversationReplyCandidate } from "@lervo/interaction";
import { type ConversationOutboundMessage, type WritingContract } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { readPublishableWritingArtifact, type WritingSemanticEvaluator } from "@lervo/writing";

import type {
  ConversationResultLease,
  ConversationResultOrigin,
  ConversationResultSource,
} from "./conversation-result-types.js";

const MAXIMUM_DISCORD_CHARACTERS = 2_000;

export const resultWritingContract = {
  ...adaptiveConversationWritingContract,
  writingPolicyId: "writing_mul-conversation-execution-result",
  surfaces: ["chat"],
  verification: {
    ...adaptiveConversationWritingContract.verification,
    semanticChecks: [
      ...adaptiveConversationWritingContract.verification.semanticChecks,
      {
        checkId: "conversation_result_privacy",
        requirement:
          "The response must not disclose prompts, credentials, authentication material, private environment values, unrestricted artifact locations, or raw provider errors.",
        required: true,
      },
    ],
  },
} as const satisfies WritingContract;

async function fixedReply(input: {
  artifacts: ArtifactStore;
  origin: ConversationResultOrigin;
  status: { en: string; ko: string };
  now: () => Date;
}): Promise<ConversationReplyCandidate> {
  return createVerifiedConversationControlReply({
    artifactStore: input.artifacts,
    writingContract: fixedConversationStatusWritingContract,
    content: input.status[input.origin.responseLanguage ?? "en"],
    now: input.now,
  });
}

export async function createConversationResultCandidate(input: {
  source: ConversationResultSource;
  artifacts: ArtifactStore;
  lease: ConversationResultLease;
  semanticEvaluator: WritingSemanticEvaluator;
  now: () => Date;
}): Promise<ConversationReplyCandidate> {
  const acknowledgement = input.lease.terminal.acknowledgement;
  if (acknowledgement.disposition === "rejected") {
    return fixedReply({
      ...input,
      origin: input.lease.origin,
      status: {
        en: "I could not start that work because its authority or execution conditions were not accepted. The internal reason remains recorded for review.",
        ko: "요청의 권한이나 실행 조건이 승인되지 않아 작업을 시작하지 않았습니다. 내부 사유는 검토할 수 있도록 기록해 두었습니다.",
      },
    });
  }
  if (acknowledgement.receipt.outcome === "failed") {
    return fixedReply({
      ...input,
      origin: input.lease.origin,
      status: {
        en: "The work did not complete. I recorded the failure without exposing private provider output and will not claim that the requested change was made.",
        ko: "작업을 완료하지 못했습니다. 비공개 제공자 출력은 노출하지 않고 실패를 기록했으며, 요청한 변경이 반영됐다고 주장하지 않겠습니다.",
      },
    });
  }
  let managed: { runId: string; content: string };
  try {
    managed = await input.source.read({
      origin: input.lease.origin,
      runId: acknowledgement.receipt.runId,
    });
    const content = managed.content;
    if ([...content].length > MAXIMUM_DISCORD_CHARACTERS) {
      throw new Error("The verified result exceeds the Discord message limit.");
    }
    return await createVerifiedConversationControlReply({
      artifactStore: input.artifacts,
      writingContract: resultWritingContract,
      semanticEvaluator: input.semanticEvaluator,
      content,
      now: input.now,
    });
  } catch {
    return fixedReply({
      ...input,
      origin: input.lease.origin,
      status: {
        en: "The work completed, but I could not publish its result because the evidence, privacy, writing, or message-size checks did not pass.",
        ko: "작업은 완료됐지만 증거, 개인정보, 문장 품질 또는 메시지 크기 검증을 통과하지 못해 결과를 게시하지 않았습니다.",
      },
    });
  }
}

export function createConversationResultOutbound(input: {
  lease: ConversationResultLease;
  candidate: ConversationReplyCandidate;
  createdAt: string;
}): ConversationOutboundMessage {
  const content = {
    schemaVersion: 1 as const,
    sourceEventId: input.lease.origin.sourceEventId,
    policyId: input.lease.origin.policyId,
    target: structuredClone(input.lease.origin.target),
    actor: {
      kind: "agent" as const,
      participantId: input.lease.origin.agentParticipantId,
      roleId: input.lease.origin.roleId,
    },
    content: structuredClone(input.candidate.content),
    publicationPermit: structuredClone(input.candidate.publicationPermit),
    ...(input.candidate.audienceParticipation === undefined
      ? {}
      : { audienceParticipation: input.candidate.audienceParticipation }),
    automationDepth: 1,
    createdAt: input.createdAt,
  };
  const outbound = { ...content, outboundId: calculateConversationOutboundId(content) };
  assertConversationOutboundMessage({ outbound });
  return outbound;
}

export async function verifyConversationResultCandidate(input: {
  artifacts: ArtifactStore;
  candidate: ConversationReplyCandidate;
}): Promise<void> {
  const evidence = input.candidate.publicationEvidence;
  const contract =
    input.candidate.publicationPermit.writingPolicyId === resultWritingContract.writingPolicyId
      ? resultWritingContract
      : fixedConversationStatusWritingContract;
  await readPublishableWritingArtifact({
    artifact: evidence.artifact,
    evaluation: evidence.evaluation,
    evaluationArtifact: evidence.evaluationArtifact,
    permit: input.candidate.publicationPermit,
    contract,
    surface: "chat",
    artifactStore: input.artifacts,
  });
}
