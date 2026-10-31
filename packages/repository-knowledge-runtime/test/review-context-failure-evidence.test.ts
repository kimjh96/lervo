import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { fixture } from "./fixture.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { createConvergenceRuntimeHost } from "../src/host.js";

// Isolate assessment context selection from the separately tested structural prefix.
vi.mock("../src/lifecycle-prefix.js", () => ({ prepareConvergenceLifecycle: async () => null }));
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("binds a failing instruction path in private stage evidence without putting it in the public code", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  await writeFile(resolve(f.root, "source.ts"), "export const source = true;\n");
  await writeFile(resolve(f.root, "AGENTS.md"), "x".repeat(172_973));
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  baseline.assessmentPaths = ["source.ts"];
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_context_failure",
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: {},
  };
  const host = createConvergenceRuntimeHost({
    storage: f.storage,
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSource: () => {},
  });
  const failure = await host
    .runStage("assessment", state, () => {})
    .catch((error: unknown) => error);
  expect(failure).toMatchObject({
    code: "review_context_unavailable",
    documentPath: "AGENTS.md",
    dependencyHash: expect.stringMatching(/^sha256:/u),
  });
  const hash = (failure as { dependencyHash: string }).dependencyHash;
  const proof = JSON.parse(
    Buffer.from(await f.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`)).toString("utf8"),
  );
  expect(proof).toMatchObject({
    kind: "private_stage_failure",
    code: "review_context_unavailable",
    documentPath: "AGENTS.md",
  });
});
