import { observeToolGeneratedDocuments, sha256 } from "@lervo/repository-knowledge";

import type { ConvergenceAssetDisposition } from "./asset-disposition-contract.js";
import {
  CONVERGENCE_ASSET_DISPOSITIONS_PATH,
  resolveConvergenceAssetDispositions,
} from "./asset-disposition-manifest.js";
import type { ConvergenceDelegation } from "./delegation-contract.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";

/**
 * ADR-0491: a delegation must not pin a tool-generated file, such as a package manager's lockfile,
 * as an opaque canonical asset; every dependency update would otherwise fail the delegation's own
 * verification. Returns the delegation and manifest bytes without those entries, or null when no
 * declaration names a tool-generated path. Every other declaration keeps its exact bytes and order.
 */
export async function withoutToolGeneratedAssetDispositions(
  root: string,
  delegation: ConvergenceDelegation,
): Promise<{
  delegation: Omit<ConvergenceDelegation, "review">;
  reviewedManifestBytes?: Uint8Array;
} | null> {
  const declared = resolveConvergenceAssetDispositions(root, delegation);
  if (declared.length === 0) return null;
  const toolGenerated = new Set(
    (
      await observeToolGeneratedDocuments({
        repositoryRoot: root,
        paths: declared.map((item) => item.path),
      })
    ).keys(),
  );
  if (toolGenerated.size === 0) return null;
  const keep = (items: readonly ConvergenceAssetDisposition[]) =>
    items.filter((item) => !toolGenerated.has(item.path));
  const { review: _review, ...plan } = structuredClone(delegation);
  if (plan.assetDispositions !== undefined) plan.assetDispositions = keep(plan.assetDispositions);
  if (delegation.assetDispositionManifestHash === undefined) return { delegation: plan };
  const current = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(
      ordinaryConvergenceSourceBytes(root, CONVERGENCE_ASSET_DISPOSITIONS_PATH, 1024 * 1024),
    ),
  ) as { schemaVersion: 1; dispositions: ConvergenceAssetDisposition[] };
  const kept = keep(current.dispositions);
  if (kept.length === current.dispositions.length) return { delegation: plan };
  const reviewedManifestBytes = new TextEncoder().encode(
    `${JSON.stringify({ schemaVersion: 1, dispositions: kept }, null, 2)}\n`,
  );
  plan.assetDispositionManifestHash = sha256(reviewedManifestBytes);
  return { delegation: plan, reviewedManifestBytes };
}

/**
 * Whether the working-tree manifest differs from the committed one only by dropped declarations
 * of tool-generated paths: the exact output of the ADR-0491 rebind, safe to commit as settled.
 */
export async function toolGeneratedManifestCleanup(input: {
  root: string;
  committed: Uint8Array | null;
  current: Uint8Array;
}): Promise<boolean> {
  if (input.committed === null) return false;
  let before: { dispositions?: ConvergenceAssetDisposition[] };
  let after: { dispositions?: ConvergenceAssetDisposition[] };
  try {
    before = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(input.committed));
    after = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(input.current));
  } catch {
    return false;
  }
  if (!Array.isArray(before.dispositions) || !Array.isArray(after.dispositions)) return false;
  const remaining = new Map(after.dispositions.map((item) => [item.path, JSON.stringify(item)]));
  const dropped = before.dispositions.filter((item) => !remaining.has(item.path));
  if (
    dropped.length === 0 ||
    before.dispositions.length - dropped.length !== after.dispositions.length ||
    before.dispositions.some(
      (item) => remaining.has(item.path) && remaining.get(item.path) !== JSON.stringify(item),
    )
  )
    return false;
  const toolGenerated = await observeToolGeneratedDocuments({
    repositoryRoot: input.root,
    paths: dropped.map((item) => item.path),
  });
  return dropped.every((item) => toolGenerated.has(item.path));
}
