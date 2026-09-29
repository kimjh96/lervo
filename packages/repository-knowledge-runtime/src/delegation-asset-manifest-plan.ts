import { sha256 } from "@lervo/repository-knowledge";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";
import type { ConvergenceDelegation } from "./delegation-contract.js";
import {
  CONVERGENCE_ASSET_DISPOSITIONS_PATH,
  resolveConvergenceAssetDispositions,
} from "./asset-disposition-manifest.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

export interface ConvergenceAssetManifestPlan {
  expectedCurrentHash: string | null;
  desiredHash: string;
  content: string;
}

/** Manifest and grant share one journal; the exact review binds both before either is written. */
export function prepareConvergenceAssetManifestPlan(
  root: string,
  delegation: ConvergenceDelegation,
  reviewedManifestBytes?: Uint8Array,
): ConvergenceAssetManifestPlan | null {
  resolveConvergenceAssetDispositions(root, delegation, reviewedManifestBytes);
  if (reviewedManifestBytes === undefined) return null;
  let current: Buffer | null;
  try {
    current = ordinaryConvergenceSourceBytes(
      root,
      CONVERGENCE_ASSET_DISPOSITIONS_PATH,
      1024 * 1024,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    current = null;
  }
  return {
    expectedCurrentHash: current === null ? null : sha256(current),
    desiredHash: sha256(reviewedManifestBytes),
    content: new TextDecoder("utf8", { fatal: true }).decode(reviewedManifestBytes),
  };
}
