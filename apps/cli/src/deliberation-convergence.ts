import type { DeliberationVerificationEvidence } from "@lervo/deliberation";
import {
  DeliberationRuntime,
  type DeliberationTurnResult,
} from "@lervo/deliberation-runtime";
import type { DeliberationPolicy, RoleProfile } from "@lervo/schemas";

import {
  createConvergedOutcome,
  createNoConsensusOutcome,
} from "./deliberation-contract.js";
import {
  decisionPrompt,
  verificationPrompt,
} from "./deliberation-prompts.js";
import {
  createDeliberationParticipantRole,
  deliberationRoleIds,
} from "./deliberation-roles.js";
import {
  presentDeliberationOutcome,
  recordDeliberationTurn,
} from "./deliberation-turn.js";
import type { DeliberationWorkspace } from "./deliberation-workspace.js";
import type {
  ManagedDeliberationOutcome,
  ManagedDeliberationRequest,
} from "./managed-deliberation.js";
import type { ManagedDeliberationRunner } from "./managed-deliberation-runner.js";

interface CurrentClaim {
  claimId: string;
  claimDigest: string;
}

export async function completeApprovedDeliberation(input: {
  request: ManagedDeliberationRequest;
  deliberationId: string;
  policy: DeliberationPolicy;
  runtime: DeliberationRuntime;
  runner: ManagedDeliberationRunner;
  workspace: DeliberationWorkspace;
  proposerRole: RoleProfile;
  approvedReview: DeliberationTurnResult;
  latestClaimArtifact: DeliberationTurnResult;
  currentClaim: CurrentClaim;
  now(): Date;
}): Promise<ManagedDeliberationOutcome> {
  const verificationTurns: DeliberationTurnResult[] = [];
  let allPassed = true;
  for (const suiteId of input.request.verificationSuiteIds) {
    const verificationRole = createDeliberationParticipantRole({
      kind: "reviewer",
      verificationSuiteIds: [suiteId],
    });
    const verificationRun = await input.runner.execute({
      provider: input.request.reviewerProvider,
      role: verificationRole,
      instructions: verificationPrompt(input.request.topic.trim(), suiteId),
      documentRules: { "writing.policy": [input.workspace.writingPolicyDocumentId] },
      verificationSuiteId: suiteId,
    });
    const verification = verificationRun.run.verifications[0];
    if (verification === undefined || verification.result.suiteId !== suiteId) {
      throw new Error("숙의 verification 실행 결과가 요청한 suite와 다릅니다.");
    }
    if (verificationRun.verificationSuite?.suiteId !== suiteId) {
      throw new Error("숙의 verification suite 원본이 실행 결과와 다릅니다.");
    }
    const evidence: DeliberationVerificationEvidence = {
      suite: verificationRun.verificationSuite,
      result: verification.result,
      resultArtifact: verification.resultArtifact,
    };
    const turn = await recordDeliberationTurn({
      runtime: input.runtime,
      runner: input.runner,
      workspace: input.workspace,
      producerRole: verificationRole,
      provider: input.request.reviewerProvider,
      run: verificationRun,
      kind: "verification",
      round: input.approvedReview.artifact.round,
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
        input.approvedReview.artifact.deliberationArtifactId,
      ],
      verificationEvidence: evidence,
    });
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
      input.request,
      outcome,
      input.runtime.history(),
      verificationTurns.at(-1)?.content ?? input.approvedReview.content,
    );
  }

  const decisionRun = await input.runner.execute({
    provider: input.request.proposerProvider,
    role: input.proposerRole,
    instructions: decisionPrompt(input.request.topic.trim()),
    documentRules: { "writing.policy": [input.workspace.writingPolicyDocumentId] },
  });
  const decision = await recordDeliberationTurn({
    runtime: input.runtime,
    runner: input.runner,
    workspace: input.workspace,
    producerRole: input.proposerRole,
    provider: input.request.proposerProvider,
    run: decisionRun,
    kind: "decision",
    round: input.approvedReview.artifact.round,
    details: {
      decisionOwnerRoleId: deliberationRoleIds.proposer,
      adoptedClaimIds: [input.currentClaim.claimId],
      verificationArtifactIds: verificationTurns.map((turn) =>
        turn.artifact.deliberationArtifactId),
      unresolvedObjectionIds: [],
    },
    previousArtifactIds: [
      input.latestClaimArtifact.artifact.deliberationArtifactId,
      input.approvedReview.artifact.deliberationArtifactId,
      ...verificationTurns.map((turn) => turn.artifact.deliberationArtifactId),
    ],
  });
  const outcome = createConvergedOutcome({
    deliberationId: input.deliberationId,
    policy: input.policy,
    history: input.runtime.history(),
    completedAt: input.now().toISOString(),
    decisionArtifactId: decision.artifact.deliberationArtifactId,
  });
  input.runtime.complete(outcome);
  return presentDeliberationOutcome(
    input.request,
    outcome,
    input.runtime.history(),
    decision.content,
  );
}
