import type { DeliberationPolicy } from "@lervo/schemas";
import type { DeliberationRuntime, DeliberationTurnResult } from "@lervo/deliberation-runtime";

import {
  createNoConsensusOutcome,
  initialClaimId,
  reviewDetails,
} from "./deliberation-contract.js";
import { proposalPrompt, revisionPrompt, reviewPrompt } from "./deliberation-prompts.js";
import type { DeliberationExecutionPlan } from "./deliberation-roles.js";
import { presentDeliberationOutcome, recordDeliberationTurn } from "./deliberation-turn.js";
import type { DeliberationWorkspace } from "./deliberation-workspace.js";
import type {
  ManagedDeliberationOutcome,
  StartManagedDeliberationRequest,
} from "./managed-deliberation.js";
import type { ManagedDeliberationRunner } from "./managed-deliberation-runner.js";

export interface ApprovedDeliberationRounds {
  status: "approved";
  currentClaim: { claimId: string; claimDigest: string };
  latestClaimArtifact: DeliberationTurnResult;
  approvedReviews: DeliberationTurnResult[];
}

export interface UnresolvedDeliberationRounds {
  status: "no_consensus";
  result: ManagedDeliberationOutcome;
  openBlockingObjectionIds: string[];
}

export type DeliberationRoundsResult = ApprovedDeliberationRounds | UnresolvedDeliberationRounds;

export async function executeDeliberationRounds(input: {
  request: StartManagedDeliberationRequest;
  plan: DeliberationExecutionPlan;
  policy: DeliberationPolicy;
  deliberationId: string;
  runtime: DeliberationRuntime;
  runner: ManagedDeliberationRunner;
  workspace: DeliberationWorkspace;
  recipientRoleIds: readonly string[];
  now(): Date;
  setOpenBlockingObjectionIds(ids: readonly string[]): void;
}): Promise<DeliberationRoundsResult> {
  const proposalRun = await input.runner.execute({
    provider: input.plan.proposer.provider,
    role: input.plan.proposer.role,
    instructions: proposalPrompt(
      input.request.topic.trim(),
      input.plan.proposer.role,
      input.workspace.writingContract.locale,
    ),
    documentRules: { "writing.policy": [input.workspace.writingPolicyDocumentId] },
  });
  const claimId = initialClaimId(input.deliberationId);
  let currentClaim = {
    claimId,
    claimDigest: proposalRun.run.resultArtifact.contentHash,
  };
  let latestClaimArtifact = await recordDeliberationTurn({
    runtime: input.runtime,
    runner: input.runner,
    workspace: input.workspace,
    producerRole: input.plan.proposer.role,
    provider: input.plan.proposer.provider,
    run: proposalRun,
    kind: "proposal",
    round: 1,
    details: { claims: [currentClaim] },
    previousArtifactIds: [],
    recipientRoleIds: input.recipientRoleIds,
  });

  for (let round = 1; round <= input.policy.maxRounds; round += 1) {
    const roundReviews: DeliberationTurnResult[] = [];
    const openBlockingObjectionIds: string[] = [];
    for (const reviewer of input.plan.reviewers) {
      const reviewRun = await input.runner.execute({
        provider: reviewer.provider,
        role: reviewer.role,
        instructions: reviewPrompt(
          input.request.topic.trim(),
          round,
          reviewer.role,
          input.workspace.writingContract.locale,
        ),
        documentRules: { "writing.policy": [input.workspace.writingPolicyDocumentId] },
      });
      const details = reviewDetails({
        content: reviewRun.content,
        contentHash: reviewRun.run.resultArtifact.contentHash,
        claimId,
        roleId: reviewer.role.roleId,
        locale: input.workspace.writingContract.locale,
      });
      const review = await recordDeliberationTurn({
        runtime: input.runtime,
        runner: input.runner,
        workspace: input.workspace,
        producerRole: reviewer.role,
        provider: reviewer.provider,
        run: reviewRun,
        kind: "objection",
        round,
        details,
        previousArtifactIds: [
          latestClaimArtifact.artifact.deliberationArtifactId,
          ...roundReviews.map((item) => item.artifact.deliberationArtifactId),
        ],
        recipientRoleIds: input.recipientRoleIds,
      });
      roundReviews.push(review);
      openBlockingObjectionIds.push(...details.objections.map((item) => item.objectionId));
      input.setOpenBlockingObjectionIds(openBlockingObjectionIds);
    }
    if (openBlockingObjectionIds.length === 0) {
      return {
        status: "approved",
        currentClaim,
        latestClaimArtifact,
        approvedReviews: roundReviews,
      };
    }
    if (round === input.policy.maxRounds) {
      const outcome = createNoConsensusOutcome({
        deliberationId: input.deliberationId,
        policy: input.policy,
        history: input.runtime.history(),
        completedAt: input.now().toISOString(),
        reason: "blocking_objections_unresolved",
        unresolvedBlockingObjectionIds: openBlockingObjectionIds,
      });
      input.runtime.complete(outcome);
      return {
        status: "no_consensus",
        result: presentDeliberationOutcome(
          input.plan,
          outcome,
          input.runtime.history(),
          roundReviews.at(-1)!.content,
        ),
        openBlockingObjectionIds,
      };
    }
    const revisionRun = await input.runner.execute({
      provider: input.plan.proposer.provider,
      role: input.plan.proposer.role,
      instructions: revisionPrompt(
        input.request.topic.trim(),
        input.plan.proposer.role,
        input.workspace.writingContract.locale,
      ),
      documentRules: { "writing.policy": [input.workspace.writingPolicyDocumentId] },
    });
    currentClaim = {
      claimId,
      claimDigest: revisionRun.run.resultArtifact.contentHash,
    };
    latestClaimArtifact = await recordDeliberationTurn({
      runtime: input.runtime,
      runner: input.runner,
      workspace: input.workspace,
      producerRole: input.plan.proposer.role,
      provider: input.plan.proposer.provider,
      run: revisionRun,
      kind: "revision",
      round: round + 1,
      details: {
        revisesArtifactId: latestClaimArtifact.artifact.deliberationArtifactId,
        claims: [currentClaim],
        resolvesObjectionIds: openBlockingObjectionIds,
      },
      previousArtifactIds: [
        latestClaimArtifact.artifact.deliberationArtifactId,
        ...roundReviews.map((item) => item.artifact.deliberationArtifactId),
      ],
      recipientRoleIds: input.recipientRoleIds,
    });
    input.setOpenBlockingObjectionIds([]);
  }
  throw new Error("Deliberation rounds ended without a terminal outcome.");
}
