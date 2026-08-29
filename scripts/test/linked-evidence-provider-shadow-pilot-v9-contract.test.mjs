import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  authorizedProviderShadowV9ContractDigest,
  createProviderShadowV2AttemptSchedule,
  loadProviderShadowV2Contract,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import {
  providerShadowMinimalSelectionProtocolDigest,
  providerShadowMinimalSelectionProtocolId,
} from "../natural-language-evaluation/linked-evidence-provider-shadow-selection-protocol.mjs";

const repositoryRoot = new URL("../..", import.meta.url);
const contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v9.json";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("minimal-sufficient paired provider-shadow v9", () => {
  it("binds six fresh paired repetition-four samples and the exact protocol", async () => {
    const loaded = await loadProviderShadowV2Contract(repositoryRoot.pathname, contractPath);
    const attempts = createProviderShadowV2AttemptSchedule(loaded.contract, loaded.executionCases);
    const bytes = await readFile(new URL(contractPath, repositoryRoot));

    expect(digest(bytes)).toBe(authorizedProviderShadowV9ContractDigest);
    expect(loaded.contract.selectionProtocol).toMatchObject({
      protocolId: providerShadowMinimalSelectionProtocolId,
      protocolDigest: providerShadowMinimalSelectionProtocolDigest,
      output: "provider_native_exact_e4_token_set",
      maximumSelectedSources: 8,
    });
    expect(attempts).toHaveLength(12);
    expect(attempts.every((item) => item.repetition === 4)).toBe(true);
    expect(attempts.every((item) => item.sampleId.startsWith("psv9_"))).toBe(true);
    expect(attempts.filter((item) => item.provider === "codex")).toHaveLength(6);
    expect(attempts.filter((item) => item.provider === "claude")).toHaveLength(6);
    expect(new Set(attempts.map((item) => item.sourceSampleId)).size).toBe(6);
  });
});
