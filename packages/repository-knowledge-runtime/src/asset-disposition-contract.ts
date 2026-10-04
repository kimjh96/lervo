import { safeConvergenceSourcePath } from "./convergence-source-path.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

export interface ConvergenceAssetDisposition {
  path: string;
  contentHash: string;
  kind: "opaque_verified" | "sensitive_local";
  verificationSuiteId: string;
  rationale: string;
}

export function parseConvergenceAssetDispositions(
  value: unknown,
  suiteIds: readonly string[],
  maximumItems: number,
): ConvergenceAssetDisposition[] {
  const items = value as ConvergenceAssetDisposition[];
  if (
    !Array.isArray(items) ||
    items.length > maximumItems ||
    new Set(items.map((item) => item?.path)).size !== items.length ||
    !items.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        Object.keys(item).sort().join() ===
          ["contentHash", "kind", "path", "rationale", "verificationSuiteId"].join() &&
        safeConvergenceSourcePath(item.path) &&
        !item.path.split("/").includes(".git") &&
        /^sha256:[a-f0-9]{64}$/u.test(item.contentHash) &&
        ["opaque_verified", "sensitive_local"].includes(item.kind) &&
        suiteIds.includes(item.verificationSuiteId) &&
        typeof item.rationale === "string" &&
        item.rationale.trim().length >= 80 &&
        item.rationale.length <= 4096,
    )
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  return structuredClone(items);
}
