import type { DeliberationVerificationEvidence } from "@lervo/deliberation";
import { DeliberationRuntime, type DeliberationTurnResult } from "@lervo/deliberation-runtime";
import type { DeliberationPolicy } from "@lervo/schemas";

import { createConvergedOutcome, createNoConsensusOutcome } from "./deliberation-contract.js";
import {
  decisionPrompt,
  verificationPrompt,
  deliberationPromptUntrusted,
} from "./deliberation-prompts.js";
import type { DeliberationExecutionPlan, DeliberationParticipant } from "./deliberation-roles.js";
import {
  executeWithPublicationRepair,
  presentDeliberationOutcome,
  recordDeliberationTurn,
} from "./deliberation-turn.js";
import type { DeliberationWorkspace } from "./deliberation-workspace.js";
import type {
  ManagedDeliberationOutcome,
  StartManagedDeliberationRequest,
} from "./managed-deliberation.js";
import type { ManagedDeliberationRunner } from "./managed-deliberation-runner.js";

interface CurrentClaim {
  claimId: string;
  claimDigest: string;
}

export async function completeApprovedDeliberation(input: {
  request: StartManagedDeliberationRequest;
  plan: DeliberationExecutionPlan;
  deliberationId: string;
  policy: DeliberationPolicy;
  runtime: DeliberationRuntime;
  runner: ManagedDeliberationRunner;
  workspace: DeliberationWorkspace;
  proposer: DeliberationParticipant;
  verifier: DeliberationParticipant;
  approvedReviews: readonly DeliberationTurnResult[];
  recipientRoleIds: readonly string[];
  latestClaimArtifact: DeliberationTurnResult;
  currentClaim: CurrentClaim;
  now(): Date;
}): Promise<ManagedDeliberationOutcome> {
  const verificationTurns: DeliberationTurnResult[] = [];
  let allPassed = true;
  for (const suiteId of input.policy.requiredVerificationSuiteIds) {
    const verificationInstructions = verificationPrompt(
      input.request.topic.trim(),
      suiteId,
      input.verifier.role,
      input.workspace.writingContract.locale,
    );
    const verificationAttempt = await executeWithPublicationRepair({
      instructions: verificationInstructions,
      execute: (instructions) =>
        input.runner.execute({
          untrustedInstructions: deliberationPromptUntrusted(
            input.request.topic.trim(),
            input.verifier.role,
          ),
          provider: input.verifier.provider,
          role: input.verifier.role,
          instructions,
          documentRules: { "writing.policy": [input.workspace.writingPolicyDocumentId] },
          verificationSuiteId: suiteId,
        }),
      record: async (run, publicationAttempt) => {
        const verification = run.run.verifications[0];
        if (verification === undefined || verification.result.suiteId !== suiteId) {
          throw new Error(
            "The deliberation verification result does not match the requested suite.",
          );
        }
        if (run.verificationSuite?.suiteId !== suiteId) {
          throw new Error(
            "The deliberation verification suite source does not match the run result.",
          );
        }
        const evidence: DeliberationVerificationEvidence = {
          suite: run.verificationSuite,
          result: verification.result,
          resultArtifact: verification.resultArtifact,
        };
        const turn = await recordDeliberationTurn({
          runtime: input.runtime,
          runner: input.runner,
          workspace: input.workspace,
          producerRole: input.verifier.role,
          provider: input.verifier.provider,
          run,
          kind: "verification",
          round: input.approvedReviews.at(-1)!.artifact.round,
          details: {
            verificationId: verification.result.verificationId,
            suiteId,
            resultArtifactId: verification.resultArtifact.artifactId,
            resultHash: verification.resultArtifact.contentHash,
            status: verification.result.status,
            targetClaims: [input.currentClaim],
          },
          previousArtifactIds: [
            input.latestClaimArtifact.artifact.deliberationArtifactId,
            ...input.approvedReviews.map((review) => review.artifact.deliberationArtifactId),
          ],
          verificationEvidence: evidence,
          recipientRoleIds: input.recipientRoleIds,
          publicationAttempt,
        });
        return { turn, verification };
      },
    });
    const { turn, verification } = verificationAttempt.recorded;
    verificationTurns.push(turn);
    allPassed &&= verification.result.status === "passed";
  }
  if (!allPassed) {
    const outcome = createNoConsensusOutcome({
      deliberationId: input.deliberationId,
      policy: input.policy,
      history: input.runtime.history(),
      completedAt: input.now().toISOString(),
      reason: "required_verification_not_passed",
      unresolvedBlockingObjectionIds: [],
    });
    input.runtime.complete(outcome);
    return presentDeliberationOutcome(
      input.plan,
      outcome,
      input.runtime.history(),
      verificationTurns.at(-1)?.content ?? input.approvedReviews.at(-1)!.content,
    );
  }

  const decisionAttempt = await executeWithPublicationRepair({
    instructions: decisionPrompt(
      input.request.topic.trim(),
      input.proposer.role,
      input.workspace.writingContract.locale,
    ),
    execute: (instructions) =>
      input.runner.execute({
        untrustedInstructions: deliberationPromptUntrusted(
          input.request.topic.trim(),
          input.proposer.role,
        ),
        provider: input.proposer.provider,
        role: input.proposer.role,
        instructions,
        documentRules: { "writing.policy": [input.workspace.writingPolicyDocumentId] },
      }),
    record: (run, publicationAttempt) =>
      recordDeliberationTurn({
        runtime: input.runtime,
        runner: input.runner,
        workspace: input.workspace,
        producerRole: input.proposer.role,
        provider: input.proposer.provider,
        run,
        kind: "decision",
        round: input.approvedReviews.at(-1)!.artifact.round,
        details: {
          decisionOwnerRoleId: input.proposer.role.roleId,
          adoptedClaimIds: [input.currentClaim.claimId],
          verificationArtifactIds: verificationTurns.map(
            (turn) => turn.artifact.deliberationArtifactId,
          ),
          unresolvedObjectionIds: [],
        },
        previousArtifactIds: [
          input.latestClaimArtifact.artifact.deliberationArtifactId,
          ...input.approvedReviews.map((review) => review.artifact.deliberationArtifactId),
          ...verificationTurns.map((turn) => turn.artifact.deliberationArtifactId),
        ],
        recipientRoleIds: input.recipientRoleIds,
        publicationAttempt,
      }),
  });
  const decision = decisionAttempt.recorded;
  const outcome = createConvergedOutcome({
    deliberationId: input.deliberationId,
    policy: input.policy,
    history: input.runtime.history(),
    completedAt: input.now().toISOString(),
    decisionArtifactId: decision.artifact.deliberationArtifactId,
  });
  input.runtime.complete(outcome);
  return presentDeliberationOutcome(input.plan, outcome, input.runtime.history(), decision.content);
}
