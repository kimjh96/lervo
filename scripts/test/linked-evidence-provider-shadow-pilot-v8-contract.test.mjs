import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV8ContractDigest,
  createProviderShadowV2AttemptSchedule,
  createProviderShadowV2StructuredSelectionSchema,
  loadProviderShadowV2Contract,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";

const repositoryRoot = new URL("../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v8.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("two-source Claude provider-shadow v8", () => {
  it("binds the exact overlay, repetition-three samples, and schema bound", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));
    const candidate = {
      documentId: "doc_one",
      contentHash: `sha256:${"a".repeat(64)}`,
      byteCount: 1,
      classes: ["recommendation"],
    };

    expect(digest(bytes)).toBe(authorizedProviderShadowV8ContractDigest);
    expect(attempts).toHaveLength(3);
    expect(attempts.every((item) => item.repetition === 3)).toBe(true);
    expect(attempts.every((item) => item.sampleId.startsWith("psv8_"))).toBe(true);
    expect(loaded.contract.selectionProtocol.maximumSelectedSources).toBe(2);
    expect(
      createProviderShadowV2StructuredSelectionSchema([candidate], 2).properties.evidenceTokens,
    ).toMatchObject({ maxItems: 2 });
  });
});
