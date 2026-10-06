import { canonicalJson, sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { ConvergenceDelegation } from "./delegation-contract.js";
import { resolveConvergenceAssetDispositions } from "./asset-disposition-manifest.js";

export interface ConvergenceAssetSettlement {
  /** Opaque assets with a matching reviewed `opaque_verified` declaration. */
  declared: number;
  /**
   * ADR-0479: opaque assets without a declaration, settled because their exact bytes belong to the
   * captured revision on which every pinned delegation suite passed. This is not visual, runtime,
   * or promotion approval, and the proof keeps the two kinds separate.
   */
  suiteBound: { path: string; contentHash: string }[];
}

/**
 * Sensitive bytes are never read, so the baseline's explicit `sensitive_local` disposition settles
 * them; policy exclusions stay visible. Every other opaque source is declared or suite-bound.
 */
export function classifyConvergenceAssets(
  root: string,
  state: KnowledgeConvergenceInput,
  delegation: Pick<
    ConvergenceDelegation,
    "assetDispositions" | "assetDispositionManifestHash" | "verification"
  >,
): ConvergenceAssetSettlement {
  const dispositionKinds = new Map(
    state.baseline.sourceDispositions?.map((item) => [item.path, item.kind]),
  );
  const assets = state.baseline.sources.filter(
    (source) =>
      source.kind === "opaque" &&
      !["policy_excluded", "sensitive_local"].includes(dispositionKinds.get(source.path) ?? ""),
  );
  const declarations = resolveConvergenceAssetDispositions(root, delegation);
  const declared = (source: { path: string; contentHash: string }) =>
    declarations.some(
      (item) =>
        item.path === source.path &&
        item.contentHash === source.contentHash &&
        item.kind === "opaque_verified",
    );
  return {
    declared: assets.filter(declared).length,
    suiteBound: assets
      .filter((source) => !declared(source))
      .map(({ path, contentHash }) => ({ path, contentHash })),
  };
}

/** The suite-bound list is private CAS evidence; the stage proof carries its count and hash. */
export async function recordConvergenceAssetSettlement(
  artifacts: ArtifactStore,
  settlement: ConvergenceAssetSettlement,
  verificationReceipts: readonly string[],
) {
  const artifact = await artifacts.put(
    canonicalJson({
      schemaVersion: 1,
      kind: "suite_bound_assets",
      sources: settlement.suiteBound,
      verificationReceipts,
    }),
  );
  return {
    declared: settlement.declared,
    suiteBound: settlement.suiteBound.length,
    suiteBoundHash: sha256(canonicalJson(settlement.suiteBound)),
    suiteBoundArtifactHash: artifact.contentHash,
  };
}
