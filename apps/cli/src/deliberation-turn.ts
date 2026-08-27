import type { DeliberationVerificationEvidence } from "@lervo/deliberation";
import {
  DeliberationRuntimeError,
  type DeliberationArtifactDetails,
  DeliberationRuntime,
  type DeliberationTurnResult,
} from "@lervo/deliberation-runtime";
import type { DeliberationArtifact, DeliberationOutcome, RoleProfile } from "@lervo/schemas";

import type { DeliberationWorkspace } from "./deliberation-workspace.js";
import type {
  ManagedDeliberationRunResult,
  ManagedDeliberationRunner,
} from "./managed-deliberation-runner.js";
import type { DeliberationExecutionPlan } from "./deliberation-roles.js";
import type { ManagedDeliberationOutcome } from "./managed-deliberation.js";
import type { RunProvider } from "./managed-run.js";
import { publicationRepairPrompt } from "./deliberation-prompts.js";

function opposite(provider: RunProvider): RunProvider {
  return provider === "codex" ? "claude" : "codex";
}

export async function executeWithPublicationRepair<T, R>(input: {
  instructions: string;
  execute(instructions: string): Promise<R>;
  record(run: R, publicationAttempt: number): Promise<T>;
}): Promise<{ run: R; recorded: T }> {
  let instructions = input.instructions;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const run = await input.execute(instructions);
    try {
      return { run, recorded: await input.record(run, attempt) };
    } catch (error) {
      const repairable =
        error instanceof DeliberationRuntimeError &&
        error.code === "artifact_publication_failed" &&
        error.reason === "writing_publication_blocked";
      if (!repairable || attempt === 2) throw error;
      instructions = publicationRepairPrompt(input.instructions);
    }
  }
  throw new Error("The bounded writing publication repair loop did not terminate.");
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
  publicationAttempt?: number;
}): Promise<DeliberationTurnResult> {
  const turn = await input.runtime.executeTurn<K>({
    kind: input.kind,
    round: input.round,
    details: input.details,
    previousArtifactIds: input.previousArtifactIds,
    sharedContextPublications: input.workspace.publications(),
    executeManagedRun: async () => input.run.run,
    writingContract: input.workspace.writingContract,
    semanticEvaluator: input.runner.semanticEvaluator(opposite(input.provider)),
    semanticEvaluatorProvider: opposite(input.provider),
    publicationAttempt: input.publicationAttempt ?? 1,
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
    throw new Error("This deliberation terminal state cannot be returned to the user.");
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
