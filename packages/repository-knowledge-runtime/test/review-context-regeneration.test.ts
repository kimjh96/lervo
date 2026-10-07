import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

import { createConvergenceRuntimeHost } from "../src/host.js";
import { captureConvergenceSources } from "../src/source-capture.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function waitingReview(contextPath: string) {
  const f = await fixture(true);
  fixtures.push(f);
  const content = "# Context\n\nBound review context.\n";
  await mkdir(resolve(f.root, contextPath, ".."), { recursive: true });
  await writeFile(resolve(f.root, contextPath), content);
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  const capture = captureConvergenceSources(f.root, baseline.policyHash);
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_stale_context",
    baseline,
    snapshotHash: capture.snapshotHash,
    receipts: [],
    stageData: {
      sourceCapture: capture,
      canonicalBatch: {
        offset: 0,
        count: 1,
        sources: [],
        context: [{ path: contextPath, contentHash: sha256(content) }],
      },
    },
  };
  const host = createConvergenceRuntimeHost({
    storage: f.storage,
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSource: () => {},
  });
  return { f, state, host };
}

it("regenerates a canonical batch whose bound context changed, instead of settling attention", async () => {
  // digimon: the waiting canonical_review bound a context document that changed afterwards.
  const { f, state, host } = await waitingReview("docs/knowledge/context.md");
  await writeFile(resolve(f.root, "docs/knowledge/context.md"), "# Context\n\nRewritten.\n");
  const result = await host.runStage("canonical_review", state, () => {});
  expect(result).toMatchObject({ state: "current", nextStage: "assessment" });
  expect(result.input.stageData).toMatchObject({
    canonicalBatch: null,
    canonicalApproval: null,
    reviewContextRegenerations: 1,
  });
});

it("regenerates through prepareStage before the owner's currency check runs", async () => {
  // ADR-0490: the deployed owner checked currency before runStage, so only this path reaches it.
  const { f, state, host } = await waitingReview("docs/knowledge/context.md");
  expect(await host.prepareStage!("canonical_review", state)).toBeNull();
  await writeFile(resolve(f.root, "docs/knowledge/context.md"), "# Context\n\nRewritten.\n");
  await expect(host.assertCurrent(state)).rejects.toMatchObject({ code: "review_context_stale" });
  const result = await host.prepareStage!("canonical_review", state);
  expect(result).toMatchObject({ state: "current", nextStage: "assessment" });
  await expect(host.assertCurrent(result!.input)).resolves.toBeUndefined();
});

it("stops regenerating after the bounded number of stale contexts", async () => {
  const { f, state, host } = await waitingReview("docs/knowledge/context.md");
  await writeFile(resolve(f.root, "docs/knowledge/context.md"), "# Context\n\nRewritten.\n");
  await expect(
    host.runStage(
      "canonical_review",
      { ...state, stageData: { ...state.stageData, reviewContextRegenerations: 3 } },
      () => {},
    ),
  ).rejects.toMatchObject({ code: "review_context_stale" });
});
