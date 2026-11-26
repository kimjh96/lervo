import { sha256 } from "@lervo/repository-knowledge";
import type { ConvergenceDelegation } from "./delegation-contract.js";
import { parseConvergenceAssetDispositions } from "./asset-disposition-contract.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

export const CONVERGENCE_ASSET_DISPOSITIONS_PATH =
  ".lervo/knowledge/convergence-asset-dispositions.json";
const maximumManifestBytes = 1024 * 1024;
const maximumDispositions = 1024;

/** Exact manifest bytes remain local authority input, never a substitute for asset verification. */
export function resolveConvergenceAssetDispositions(
  root: string,
  delegation: Pick<
    ConvergenceDelegation,
    "assetDispositions" | "assetDispositionManifestHash" | "verification"
  >,
  reviewedManifestBytes?: Uint8Array,
) {
  const inline = delegation.assetDispositions ?? [];
  if (delegation.assetDispositionManifestHash === undefined) {
    if (reviewedManifestBytes !== undefined)
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    return inline;
  }
  try {
    const bytes =
      reviewedManifestBytes ??
      ordinaryConvergenceSourceBytes(
        root,
        CONVERGENCE_ASSET_DISPOSITIONS_PATH,
        maximumManifestBytes,
      );
    if (
      bytes.byteLength > maximumManifestBytes ||
      sha256(bytes) !== delegation.assetDispositionManifestHash
    )
      throw new Error("Invalid asset manifest binding.");
    const value: unknown = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
    const manifest = value as { schemaVersion?: unknown; dispositions?: unknown } | null;
    if (
      manifest === null ||
      typeof manifest !== "object" ||
      Object.keys(manifest).sort().join() !== "dispositions,schemaVersion" ||
      manifest.schemaVersion !== 1
    )
      throw new Error("Invalid asset manifest contract.");
    const dispositions = parseConvergenceAssetDispositions(
      manifest.dispositions,
      delegation.verification.map((suite) => suite.suiteId),
      maximumDispositions,
    );
    return parseConvergenceAssetDispositions(
      [...inline, ...dispositions],
      delegation.verification.map((suite) => suite.suiteId),
      maximumDispositions,
    );
  } catch (error) {
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable", { cause: error });
  }
}
