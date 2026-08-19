import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  calculateDeliberationOutcomeId,
  deliberationPolicyHash,
} from "@lervo/deliberation";
import type {
  DeliberationOutcome,
  DeliberationPolicy,
  HandoffBundle,
  SharedContextPublication,
} from "@lervo/schemas";

import type { DeliberationTurnResult } from "../src/index.js";
import {
  deliberationId,
  hash,
  objectionId,
  projectId,
  proposalDocumentId,
  proposalPath,
} from "./fixture.js";

export async function materializeProposalContext(input: {
  root: string;
  proposal: DeliberationTurnResult;
  sharedContextId: string;
  handoffId: string;
}): Promise<{
  publication: SharedContextPublication;
  handoff: HandoffBundle;
}> {
  await writeFile(resolve(input.root, proposalPath), input.proposal.content);
  const publication: SharedContextPublication = {
    schemaVersion: 1,
    sharedContextId: input.sharedContextId,
    projectId,
    kind: "artifact_summary",
    documentId: proposalDocumentId,
    contentHash: input.proposal.artifact.content.contentHash,
    sourceRevision: `artifact:${input.proposal.artifact.deliberationArtifactId}`,
    producer: {
      kind: "agent",
      roleId: input.proposal.artifact.producer.roleId,
      runId: input.proposal.artifact.producer.runId,
      sessionId: input.proposal.artifact.producer.sessionId,
    },
    audience: { mode: "roles", roleIds: ["reviewer"] },
    sensitivity: "normal",
    evidenceEventIds: [input.proposal.recordedEvent.eventId],
    publishedAt: input.proposal.artifact.createdAt,
    expiresAt: null,
    supersedesSharedContextId: null,
  };
  const handoff: HandoffBundle = {
    schemaVersion: 1,
    handoffId: input.handoffId,
    projectId,
    from: {
      roleId: input.proposal.artifact.producer.roleId,
      runId: input.proposal.artifact.producer.runId,
      sessionId: input.proposal.artifact.producer.sessionId,
      contextGeneration: input.proposal.artifact.inputContext.contextGeneration,
    },
    toRoleId: "reviewer",
    requestDigest: hash(`review:${input.proposal.artifact.deliberationArtifactId}`),
    sharedContextIds: [publication.sharedContextId],
    evidenceEventIds: [input.proposal.recordedEvent.eventId],
    createdAt: input.proposal.artifact.createdAt,
  };
  return { publication, handoff };
}

export function noConsensusOutcome(input: {
  policy: DeliberationPolicy;
  proposal: DeliberationTurnResult;
  review: DeliberationTurnResult;
  completedAt: string;
}): DeliberationOutcome {
  const withoutId = {
    schemaVersion: 1 as const,
    outcomeId: "dlo_0000000000000000",
    deliberationId,
    projectId,
    policyId: input.policy.policyId,
    policyHash: deliberationPolicyHash(input.policy),
    status: "no_consensus" as const,
    lastRound: 1,
    artifactIds: [
      input.proposal.artifact.deliberationArtifactId,
      input.review.artifact.deliberationArtifactId,
    ],
    lastConfirmedArtifactId: input.review.artifact.deliberationArtifactId,
    decisionArtifactId: null,
    passedVerificationArtifactIds: [],
    unresolvedBlockingObjectionIds: [objectionId],
    noConsensusReason: "blocking_objections_unresolved" as const,
    failure: null,
    completedAt: input.completedAt,
  };
  return {
    ...withoutId,
    outcomeId: calculateDeliberationOutcomeId(withoutId as DeliberationOutcome),
  } as DeliberationOutcome;
}
