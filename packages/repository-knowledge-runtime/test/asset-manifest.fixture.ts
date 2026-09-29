import { sha256 } from "@lervo/repository-knowledge";
import { convergenceDelegationPlanHash } from "../src/delegation.js";
import type { ConvergenceDelegation } from "../src/delegation-contract.js";

export function assetManifest(count = 277) {
  return {
    schemaVersion: 1,
    dispositions: Array.from({ length: count }, (_, index) => ({
      path: `assets/model-${index}.bin`,
      contentHash: sha256(Buffer.from([0, index % 256])),
      kind: "opaque_verified" as const,
      verificationSuiteId: "knowledge.fixture",
      rationale:
        "This exact opaque asset is retained with its recorded byte hash under the pinned repository verification contract; it establishes no visual or runtime promotion.",
    })),
  };
}

export function reviewedManifestDelegation(delegation: ConvergenceDelegation, bytes: Uint8Array) {
  const { review, ...old } = delegation;
  const body = { ...old, assetDispositionManifestHash: sha256(bytes) };
  return { ...body, review: { ...review, planHash: convergenceDelegationPlanHash(body) } };
}
