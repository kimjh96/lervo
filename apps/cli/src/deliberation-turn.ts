import type { DeliberationVerificationEvidence } from "@lervo/deliberation";
import {
  type DeliberationArtifactDetails,
  DeliberationRuntime,
  type DeliberationTurnResult,
} from "@lervo/deliberation-runtime";
import { defaultKoreanWritingContract } from "@lervo/core";
import type { DeliberationArtifact, DeliberationOutcome, RoleProfile } from "@lervo/schemas";

import type { DeliberationWorkspace } from "./deliberation-workspace.js";
import type {
  ManagedDeliberationRunResult,
  ManagedDeliberationRunner,
} from "./managed-deliberation-runner.js";
import type {
  DeliberationExecutionPlan,
} from "./deliberation-roles.js";
import type {
  ManagedDeliberationOutcome,
} from "./managed-deliberation.js";
import type { RunProvider } from "./managed-run.js";

function opposite(provider: RunProvider): RunProvider {
  return provider === "codex" ? "claude" : "codex";
}

export async function recordDeliberationTurn<K extends DeliberationArtifact["kind"]>(input: {
  runtime: DeliberationRuntime;
  runner: ManagedDeliberationRunner;
  workspace: DeliberationWorkspace;
  producerRole: RoleProfile;
  provider: RunProvider;
  run: ManagedDeliberationRunResult;
  kind: K;
  round: number;
  details: DeliberationArtifactDetails<K>;
  previousArtifactIds: readonly string[];
  verificationEvidence?: DeliberationVerificationEvidence;
  recipientRoleIds: readonly string[];
}): Promise<DeliberationTurnResult> {
  const turn = await input.runtime.executeTurn<K>({
    kind: input.kind,
    round: input.round,
    details: input.details,
    previousArtifactIds: input.previousArtifactIds,
    sharedContextPublications: input.workspace.publications(),
    executeManagedRun: async () => input.run.run,
    writingContract: defaultKoreanWritingContract,
    semanticEvaluator: input.runner.semanticEvaluator(opposite(input.provider)),
    ...(input.verificationEvidence === undefined
      ? {}
      : { verificationEvidence: input.verificationEvidence }),
  });
  const context = await input.workspace.materializeTurn({
    turn,
    producerRole: input.producerRole,
  });
  for (const roleId of input.recipientRoleIds) {
    const handoff = context.handoffFor(roleId);
    input.runtime.publishHandoff({
      artifactId: turn.artifact.deliberationArtifactId,
      publication: context.publication,
      handoff,
    });
    input.workspace.rememberContext({
      publication: context.publication,
      handoff,
      producerRole: input.producerRole,
    });
  }
  return turn;
}

export function presentDeliberationOutcome(
  plan: DeliberationExecutionPlan,
  outcome: DeliberationOutcome,
  history: readonly DeliberationArtifact[],
  finalContent: string,
): ManagedDeliberationOutcome {
  if (outcome.status !== "converged" && outcome.status !== "no_consensus") {
    throw new Error("사용자에게 반환할 수 없는 숙의 종료 상태입니다.");
  }
  return {
    deliberationId: outcome.deliberationId,
    status: outcome.status,
    outcome: structuredClone(outcome),
    artifactCount: history.length,
    finalContent,
    providers: {
      proposer: plan.proposer.provider,
      reviewer: plan.reviewers[0]!.provider,
    },
    participants: plan.participants.map((participant) => ({
      roleId: participant.role.roleId,
      name: participant.role.name,
      provider: participant.provider,
      responsibilities: [...participant.responsibilities],
    })),
  };
}
