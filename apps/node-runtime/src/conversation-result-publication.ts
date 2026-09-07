import {
  assertConversationOutboundMessage,
  calculateConversationOutboundId,
} from "@lervo/conversation-contract";
import { createVerifiedConversationControlReply } from "@lervo/conversation-control";
import { defaultEnglishWritingContract, fixedEnglishStatusWritingContract } from "@lervo/core";
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

const resultWritingContract = {
  ...defaultEnglishWritingContract,
  writingPolicyId: "writing_en-conversation-execution-result",
  surfaces: ["chat"],
  verification: {
    ...defaultEnglishWritingContract.verification,
    semanticChecks: [
      ...defaultEnglishWritingContract.verification.semanticChecks,
      {
        checkId: "conversation_result_privacy",
        requirement:
          "The response must not disclose prompts, credentials, authentication material, private environment values, unrestricted artifact locations, or raw provider errors.",
        required: true,
      },
    ],
  },
} as const satisfies WritingContract;

function coordinates(origin: ConversationResultOrigin, runId: string | null): string[] {
  return [
    `Delivery: ${origin.deliveryId}`,
    `Run: ${runId ?? "none"}`,
    `Workstream: ${origin.workstreamId} revision ${origin.workstreamRevision}`,
    `Workstream snapshot: ${origin.workstreamSnapshotContentHash}`,
    `Assignment: ${origin.assignmentId ?? "none"}`,
    `Agent: ${origin.agentId ?? "none"}`,
  ];
}

async function fixedReply(input: {
  artifacts: ArtifactStore;
  origin: ConversationResultOrigin;
  runId: string | null;
  status: string;
  now: () => Date;
}): Promise<ConversationReplyCandidate> {
  return createVerifiedConversationControlReply({
    artifactStore: input.artifacts,
    writingContract: fixedEnglishStatusWritingContract,
    content: [...coordinates(input.origin, input.runId), `Status: ${input.status}`].join("\n"),
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
      runId: null,
      status: `The remote command was rejected with code ${acknowledgement.rejectionCode}.`,
    });
  }
  if (acknowledgement.receipt.outcome === "failed") {
    return fixedReply({
      ...input,
      origin: input.lease.origin,
      runId: null,
      status: `Managed execution failed with code ${acknowledgement.receipt.failureCode}. No provider error or output was published.`,
    });
  }
  let managed: { runId: string; content: string };
  try {
    managed = await input.source.read({
      origin: input.lease.origin,
      runId: acknowledgement.receipt.runId,
    });
    const content = [
      ...coordinates(input.lease.origin, managed.runId),
      "Status: Managed execution completed and passed its required verification.",
      "",
      "Result:",
      managed.content,
    ].join("\n");
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
      runId: acknowledgement.receipt.runId,
      status:
        "Managed execution completed, but result publication was blocked by the bounded evidence, privacy, writing, or channel-size contract.",
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
      : fixedEnglishStatusWritingContract;
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
