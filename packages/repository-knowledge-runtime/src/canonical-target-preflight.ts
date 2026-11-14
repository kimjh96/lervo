import { execFileSync } from "node:child_process";
import {
  recordSynchronousGitProcess,
  sha256,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import { assertConvergenceDelegation, pathWithinConvergenceRoots } from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { captureConvergenceSources } from "./source-capture.js";
import { convergenceGit } from "./canonical-workspace.js";
import type { CanonicalDraft } from "./canonical-assessment-contract.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { hasCanonicalNormalizationLineage } from "./canonical-normalization-lineage.js";
import { synchronizeIntegrationTarget } from "./integration-target-sync.js";
import { committedBlobHashes } from "./committed-blob-hashes.js";
import { recordIntegrationTargetAbsorbed } from "./integration-target-absorption-event.js";
import { canonicalDraftKey, integratedCanonicalDrafts } from "./canonical-disposition-ledger.js";
import type { ParkedTargetObservation } from "./convergence-parking.js";

/**
 * A reviewed working copy cannot silently replace different committed target bytes. Returns every
 * draft target whose integration-ref bytes diverge from the reviewed preimage; ADR-0530 parks
 * their sources instead of holding the whole obligation.
 */
export async function preflightCanonicalTargets(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  drafts: CanonicalDraft[],
): Promise<ParkedTargetObservation[]> {
  const root = context.storage.paths.repositoryRoot;
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: state.baseline.projectId,
    expectedHash: state.baseline.delegationHash,
    provider: context.provider,
  });
  const targetRef = delegation.integrationTarget.ref;
  // Integrate and verify drafts on the reviewed working branch, not on a stale target tree.
  const integrated = await integratedCanonicalDrafts(
    context.storage.events,
    context.storage.artifacts,
  );
  // Synchronization can move the integration ref; no other await separates it from this fence.
  context.assertSourceExact(state);
  await synchronizeIntegrationTarget({
    repositoryRoot: root,
    ref: targetRef,
    integrated: (path, hash) => integrated.has(canonicalDraftKey(path, hash)),
    recordAbsorbed: (absorption) =>
      recordIntegrationTargetAbsorbed(context.storage, absorption, new Date().toISOString()),
  });
  context.sourceObservation?.noteChange();
  const targetCommit = await convergenceGit(root, ["rev-parse", targetRef]);
  const sourceHashes = new Map(
    (
      (state.stageData.sourceCapture as ReturnType<typeof captureConvergenceSources> | undefined)
        ?.sources ?? state.baseline.sources
    ).map((source) => [source.path, source.contentHash]),
  );
  const diverged: Omit<ParkedTargetObservation, "headHash">[] = [];
  for (const draft of drafts) {
    if (!pathWithinConvergenceRoots(draft.path, delegation.canonicalRoots))
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    if ((sourceHashes.get(draft.path) ?? null) !== draft.beforeHash)
      throw new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");
    let before: string | null = null;
    recordSynchronousGitProcess(["show"]);
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
      diverged.push({
        ref: targetRef,
        path: draft.path,
        observedHash: before,
        preimageHash: draft.beforeHash,
      });
  }
  const headHashes = await committedBlobHashes(
    root,
    "HEAD",
    diverged.map((target) => target.path),
  );
  context.assertSourceCurrent(state);
  return diverged.map((target) => ({
    ref: target.ref,
    path: target.path,
    observedHash: target.observedHash,
    headHash: headHashes.get(target.path) ?? null,
    preimageHash: target.preimageHash,
  }));
}
