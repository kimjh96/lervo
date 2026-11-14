import { execFileSync } from "node:child_process";
import {
  listAssignments,
  readWorkspaceIntegrationAttempt,
  hasExactWorkspaceIntegrationRecordedEvent,
  readWorkspace,
} from "@lervo/agent-workforce";
import {
  canonicalJson,
  recordSynchronousGitProcess,
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import type {
  WorkspaceIntegrationPlan,
  WorkspaceIntegrationVerificationReceipt,
  WorkspaceIntegrationCompletionReceipt,
} from "@lervo/orchestrator";
import { assertConvergenceDelegation, pathWithinConvergenceRoots } from "./delegation.js";
import { readConvergenceEffectCheckpoint } from "./effect-checkpoint.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { CanonicalDraft } from "./canonical-assessment-contract.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { hasCanonicalNormalizationLineage } from "./canonical-normalization-lineage.js";

/** Observes a completed exact ref effect. It neither advances Git nor revives its old lease. */
export async function inspectRetainedCanonicalIntegration(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  drafts: CanonicalDraft[],
): Promise<{
  sealedInput: KnowledgeConvergenceInput;
  plan: WorkspaceIntegrationPlan;
  verification: WorkspaceIntegrationVerificationReceipt;
  completion: WorkspaceIntegrationCompletionReceipt;
} | null> {
  const root = context.storage.paths.repositoryRoot;
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: state.baseline.projectId,
    expectedHash: state.baseline.delegationHash,
    provider: context.provider,
  });
  const assignments = await listAssignments(root);
  let sealedInput = state;
  if (!state.stageData.canonicalSealed) {
    const writer = assignments.find(
      (item) =>
        item.convergence?.inputArtifactHash === sha256(canonicalJson(state)) &&
        item.convergence.stage === "canonical_integration" &&
        item.taskType !== "repository.integration" &&
        item.status === "completed",
    );
    const artifact = writer?.resultArtifacts[0];
    if (!artifact) return null;
    const bytes = await context.storage.artifacts.get(
      `lervo-cas://sha256/${artifact.contentHash.slice(7)}`,
    );
    if (sha256(bytes) !== artifact.contentHash)
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    const result = JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(bytes),
    ) as KnowledgeConvergenceStageResult;
    if (
      result.assignmentId !== writer!.assignmentId ||
      result.input.obligationId !== state.obligationId ||
      result.input.snapshotHash !== state.snapshotHash
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    sealedInput = result.input;
  }
  const sealed = sealedInput.stageData.canonicalSealed as
    { workspaceId: string; resultHash: string } | undefined;
  if (!sealed) return null;
  const integrator = assignments.find(
    (item) =>
      item.taskType === "repository.integration" &&
      item.convergence?.inputArtifactHash === sha256(canonicalJson(sealedInput)) &&
      item.convergence.obligationId === state.obligationId,
  );
  if (!integrator) return null;
  const load = <T>(effect: string) =>
    readConvergenceEffectCheckpoint<T>({
      storage: context.storage,
      assignmentId: integrator.assignmentId,
      inputArtifactHash: integrator.convergence!.inputArtifactHash,
      effect,
    });
  const plan = await load<WorkspaceIntegrationPlan>("integration_plan");
  const verification = await load<WorkspaceIntegrationVerificationReceipt>(
    "integration_verification",
  );
  if (!plan || !verification) return null;
  const observed = await readWorkspaceIntegrationAttempt(root, plan.attempt.targetLeaseId);
  if (observed?.attempt.state !== "integrated") return null;
  const attempt = observed.attempt;
  if (
    plan.repositoryRoot !== root ||
    plan.integrationAssignmentId !== integrator.assignmentId ||
    plan.targetRef !== delegation.integrationTarget.ref ||
    attempt.planContentHash !== plan.contentHash ||
    attempt.attemptId !== verification.attemptId ||
    attempt.verificationReceiptHash !== verification.contentHash ||
    plan.sources.length !== 1 ||
    plan.sources[0]!.workspaceId !== sealed.workspaceId ||
    canonicalJson(plan.verificationRequirements) !== canonicalJson(delegation.verification) ||
    !(await hasExactWorkspaceIntegrationRecordedEvent({
      repositoryRoot: root,
      eventId: plan.integratedAttemptEventId,
      attempt,
    }))
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  const source = await readWorkspace(root, sealed.workspaceId);
  if (
    source?.workspace.state !== "integrated" ||
    source.workspace.integrationEvidenceId !== attempt.attemptId ||
    source.workspace.sealedResult?.resultArtifactHash !== sealed.resultHash
  )
    return null;
  const sourceBytes = await context.storage.artifacts.get(
    `lervo-cas://sha256/${sealed.resultHash.slice(7)}`,
  );
  if (sha256(sourceBytes) !== sealed.resultHash)
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  const sourceProof = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(sourceBytes));
  if (
    sourceProof.obligationId !== state.obligationId ||
    canonicalJson(sourceProof.drafts) !== canonicalJson(drafts)
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  for (const result of verification.results) {
    const bytes = await context.storage.artifacts.get(
      `lervo-cas://sha256/${result.resultContentHash.slice(7)}`,
    );
    if (sha256(bytes) !== result.resultContentHash)
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  }
  recordSynchronousGitProcess(["rev-parse"]);
  const target = execFileSync("git", ["-C", root, "rev-parse", plan.targetRef], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (target !== attempt.targetAfterCommit) return null;
  for (const draft of drafts) {
    if (!pathWithinConvergenceRoots(draft.path, delegation.canonicalRoots))
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    recordSynchronousGitProcess(["show"]);
    const after = sha256(
      execFileSync("git", ["-C", root, "show", `${target}:${draft.path}`], {
        maxBuffer: 256 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    let before: string | null = null;
    recordSynchronousGitProcess(["show"]);
    try {
      before = sha256(
        execFileSync("git", ["-C", root, "show", `${plan.targetBeforeCommit}:${draft.path}`], {
          maxBuffer: 256 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    } catch (error) {
      if ((error as { status?: number }).status !== 128) throw error;
    }
    if (
      after !== sha256(draft.content) ||
      !(await hasCanonicalNormalizationLineage(
        context,
        state,
        draft.path,
        before,
        draft.beforeHash,
      ))
    )
      return null;
  }
  const completionContent = {
    schemaVersion: 1 as const,
    status: "integrated" as const,
    attemptId: attempt.attemptId,
    targetLeaseId: attempt.targetLeaseId,
    targetBeforeCommit: attempt.targetBeforeCommit,
    targetAfterCommit: attempt.targetAfterCommit!,
    verificationReceiptHash: attempt.verificationReceiptHash!,
    integratedWorkspaceIds: attempt.sources.map((item) => item.workspaceId),
    recordedAt: attempt.updatedAt,
  };
  context.assertSource(state);
  return {
    sealedInput,
    plan,
    verification,
    completion: { ...completionContent, contentHash: sha256(canonicalJson(completionContent)) },
  };
}
