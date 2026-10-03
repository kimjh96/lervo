import { assertConvergenceDelegation } from "./delegation.js";
import {
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { waitingConvergenceStage } from "./stage-receipt.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { resolveConvergenceAssetDispositions } from "./asset-disposition-manifest.js";

/**
 * Opaque bytes need exact typed verification before currency. Sensitive bytes are never read, so the
 * baseline's explicit `sensitive_local` disposition settles them; a content hash would add no proof.
 */
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
  const dispositionKinds = new Map(
    state.baseline.sourceDispositions?.map((item) => [item.path, item.kind]),
  );
  const assets = state.baseline.sources.filter(
    (source) =>
      source.kind === "opaque" &&
      !["policy_excluded", "sensitive_local"].includes(dispositionKinds.get(source.path) ?? ""),
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
          item.kind === "opaque_verified",
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
