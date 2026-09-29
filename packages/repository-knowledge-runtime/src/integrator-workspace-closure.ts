import { readWorkspace, updateWorkspace } from "@lervo/agent-workforce";
import {
  planWorkspaceSeal,
  type WorkspaceIntegrationPlan,
  type WorkspaceIntegrationVerificationReceipt,
  type WorkspaceIntegrationCompletionReceipt,
} from "@lervo/orchestrator";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { convergenceEffectCheckpoint } from "./effect-checkpoint.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Freeze and seal the integrator after its verified exact target advancement, before returning its lease. */
export async function closeIntegratedConvergenceWorkspace(
  context: ConvergenceRuntimeContext,
  authority: ConvergenceAssignmentAuthority,
  integrationPlan: WorkspaceIntegrationPlan,
  verification: WorkspaceIntegrationVerificationReceipt,
  completion: WorkspaceIntegrationCompletionReceipt,
): Promise<void> {
  await authority.assertCurrent();
  const root = context.storage.paths.repositoryRoot;
  const plan = await convergenceEffectCheckpoint({
    storage: context.storage,
    assignment: authority.assignment,
    effect: "integrator_seal",
    prepare: async () => {
      const proof = await context.storage.artifacts.put(
        canonicalJson({ integration: completion, verification }),
      );
      return planWorkspaceSeal({
        repositoryRoot: root,
        workspacePath: integrationPlan.integrationWorkspacePath,
        workspaceId: integrationPlan.integrationWorkspaceId,
        agentId: authority.agent.agentId,
        leaseId: authority.assignment.lease!.leaseId,
        provider: context.provider,
        writerSessionId: integrationPlan.integratorWriterSessionId,
        resultArtifactId: `art_${proof.contentHash.slice(7, 39)}`,
        resultArtifactHash: proof.contentHash,
        verificationResults: verification.results.map((result) => ({
          suiteId: result.suiteId,
          policyHash: result.suiteHash,
          resultArtifactId: result.resultArtifactId,
          resultArtifactHash: result.resultContentHash,
          completedAt: result.completedAt,
          passed: true,
        })),
        host: new GitWorkspaceHostAdapter(),
      });
    },
  });
  const observed = await new GitWorkspaceHostAdapter().inspectResult({
    repositoryRoot: root,
    workspacePath: plan.workspacePath,
    baseCommit: plan.sealedResult.baseCommit,
    marker: plan.marker,
  });
  if (
    !observed.markerMatched ||
    observed.clean !== true ||
    observed.gitOperationInProgress !== false ||
    observed.headCommit !== completion.targetAfterCommit ||
    observed.treeHash !== plan.sealedResult.treeHash
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  let stored = await readWorkspace(root, plan.workspaceId);
  if (
    !stored ||
    stored.workspace.assignmentId !== authority.assignment.assignmentId ||
    stored.workspace.leaseGeneration !== authority.assignment.lease!.generation
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  if (stored.workspace.state === "integrated") {
    if (
      stored.workspace.integrationEvidenceId !== completion.attemptId ||
      canonicalJson(stored.workspace.sealedResult) !== canonicalJson(plan.sealedResult)
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    return;
  }
  for (const nextState of ["sealing", "sealed", "integrated"] as const) {
    if (
      stored.workspace.state === nextState ||
      (nextState === "sealing" && stored.workspace.state === "sealed")
    )
      continue;
    await authority.assertCurrent();
    stored = await updateWorkspace({
      repositoryRoot: root,
      workspaceId: plan.workspaceId,
      expectedContentHash: stored.contentHash,
      expectedRevision: stored.workspace.revision,
      expectedGeneration: stored.workspace.generation,
      eventId:
        nextState === "sealing"
          ? plan.sealingEventId
          : nextState === "sealed"
            ? plan.sealedEventId
            : `evt_${sha256(canonicalJson([completion.attemptId, plan.workspaceId, "integrator_closed"])).slice(7, 39)}`,
      nextState,
      occurredAt: new Date().toISOString(),
      ...(nextState === "sealing"
        ? { evidence: { writerFrozen: true }, writerSession: null }
        : nextState === "sealed"
          ? { evidence: { checkoutClean: true }, sealedResult: plan.sealedResult }
          : {
              evidence: { integrationVerified: true },
              integrationEvidenceId: completion.attemptId,
            }),
    });
  }
}
