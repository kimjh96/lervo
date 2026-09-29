import { assertConvergenceDelegation } from "./delegation.js";
import {
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { waitingConvergenceStage } from "./stage-receipt.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { resolveConvergenceAssetDispositions } from "./asset-disposition-manifest.js";

/** Opaque and sensitive bytes never enter text review or silently count as semantic coverage. */
export async function unresolvedConvergenceAssets(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
): Promise<KnowledgeConvergenceStageResult | null> {
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: context.storage.paths.repositoryRoot,
    projectId: state.baseline.projectId,
    expectedHash: state.baseline.delegationHash,
    provider: context.provider,
  });
  const assets = state.baseline.sources.filter(
    (source) =>
      (source.kind === "opaque" &&
        state.baseline.sourceDispositions?.find((item) => item.path === source.path)?.kind !==
          "policy_excluded") ||
      state.baseline.sourceDispositions?.some(
        (item) => item.path === source.path && item.kind === "sensitive_local",
      ),
  );
  const dispositions = resolveConvergenceAssetDispositions(
    context.storage.paths.repositoryRoot,
    delegation,
  );
  const unresolved = assets.filter(
    (source) =>
      !dispositions.some(
        (item) =>
          item.path === source.path &&
          item.contentHash === source.contentHash &&
          item.kind === (source.kind === "opaque" ? "opaque_verified" : "sensitive_local"),
      ),
  );
  if (!unresolved.length) return null;
  return waitingConvergenceStage({
    artifacts: context.storage.artifacts,
    state,
    kind: "attention_required",
    reason: "asset_verification_required",
    dependency: {
      schemaVersion: 1,
      kind: "typed_asset_verification",
      snapshotHash: state.snapshotHash,
      sources: unresolved.map(({ path, contentHash, kind }) => ({ path, contentHash, kind })),
      delegationHash: state.baseline.delegationHash,
    },
  });
}
