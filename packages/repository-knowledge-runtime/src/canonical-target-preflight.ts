import { execFileSync } from "node:child_process";
import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { waitingConvergenceStage } from "./stage-receipt.js";
import { assertConvergenceDelegation, pathWithinConvergenceRoots } from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { captureConvergenceSources } from "./source-capture.js";
import { convergenceGit } from "./canonical-workspace.js";
import type { CanonicalDraft } from "./canonical-assessment-contract.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { hasCanonicalNormalizationLineage } from "./canonical-normalization-lineage.js";
import { synchronizeIntegrationTarget } from "./integration-target-sync.js";
import { recordIntegrationTargetAbsorbed } from "./integration-target-absorption-event.js";
import { canonicalDraftKey, integratedCanonicalDrafts } from "./canonical-disposition-ledger.js";

/** A reviewed working copy cannot silently replace different committed target bytes. */
export async function preflightCanonicalTargets(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  drafts: CanonicalDraft[],
): Promise<Awaited<ReturnType<typeof waitingConvergenceStage>> | null> {
  const root = context.storage.paths.repositoryRoot;
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: state.baseline.projectId,
    expectedHash: state.baseline.delegationHash,
    provider: context.provider,
  });
  context.assertSource(state);
  const targetRef = delegation.integrationTarget.ref;
  // Integrate and verify drafts on the reviewed working branch, not on a stale target tree.
  const integrated = await integratedCanonicalDrafts(
    context.storage.events,
    context.storage.artifacts,
  );
  await synchronizeIntegrationTarget({
    repositoryRoot: root,
    ref: targetRef,
    integrated: (path, hash) => integrated.has(canonicalDraftKey(path, hash)),
    recordAbsorbed: (absorption) =>
      recordIntegrationTargetAbsorbed(context.storage, absorption, new Date().toISOString()),
  });
  const targetCommit = await convergenceGit(root, ["rev-parse", targetRef]);
  const sourceHashes = new Map(
    (
      (state.stageData.sourceCapture as ReturnType<typeof captureConvergenceSources> | undefined)
        ?.sources ?? state.baseline.sources
    ).map((source) => [source.path, source.contentHash]),
  );
  for (const draft of drafts) {
    if (!pathWithinConvergenceRoots(draft.path, delegation.canonicalRoots))
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    if ((sourceHashes.get(draft.path) ?? null) !== draft.beforeHash)
      throw new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");
    let before: string | null = null;
    try {
      before = sha256(
        execFileSync("git", ["-C", root, "show", `${targetCommit}:${draft.path}`], {
          encoding: "buffer",
          maxBuffer: 256 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    } catch (error) {
      if ((error as { status?: number }).status !== 128) throw error;
    }
    if (
      !(await hasCanonicalNormalizationLineage(
        context,
        state,
        draft.path,
        before,
        draft.beforeHash,
      ))
    )
      return waitingConvergenceStage({
        artifacts: context.storage.artifacts,
        state,
        kind: "waiting_authority",
        reason: "canonical_target_diverged",
        dependency: {
          kind: "canonical_target_preimage",
          snapshotHash: state.snapshotHash,
          delegationHash: state.baseline.delegationHash,
          targetRef,
          targetCommit,
          path: draft.path,
          expectedHash: draft.beforeHash,
          observedHash: before,
        },
      });
  }
  context.assertSource(state);
  return null;
}
