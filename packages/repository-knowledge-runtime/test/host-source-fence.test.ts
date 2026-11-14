import { writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

import { discoverConvergenceBaseline } from "../src/baseline.js";
import { createConvergenceRuntimeHost } from "../src/host.js";
import { captureConvergenceSources } from "../src/source-capture.js";
import { fixture } from "./fixture.js";

vi.mock("../src/source-capture.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/source-capture.js")>();
  return { ...actual, captureConvergenceSources: vi.fn(actual.captureConvergenceSources) };
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.mocked(captureConvergenceSources).mockClear();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function currentState() {
  const f = await fixture();
  fixtures.push(f);
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  const capture = captureConvergenceSources(f.root, baseline.policyHash);
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_source_fence",
    baseline,
    snapshotHash: capture.snapshotHash,
    receipts: [],
    stageData: { sourceCapture: capture },
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
  vi.mocked(captureConvergenceSources).mockClear();
  return { f, state, host };
}

const captures = () => vi.mocked(captureConvergenceSources).mock.calls.length;

it("reuses the pre-stage capture for the owner's immediately following currency check", async () => {
  const { state, host } = await currentState();
  await expect(host.prepareStage!("assessment", state)).resolves.toBeNull();
  await host.assertCurrent(state);
  // The closing capture of the currency check still runs.
  expect(captures()).toBe(2);
});

it("captures again once any I/O turn separates the pre-stage check from the currency check", async () => {
  const { state, host } = await currentState();
  await host.prepareStage!("assessment", state);
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  await host.assertCurrent(state);
  expect(captures()).toBe(3);
});

it("captures again for a different state and for a repeated currency check", async () => {
  const { state, host } = await currentState();
  await host.prepareStage!("assessment", state);
  await host.assertCurrent({ ...state });
  await host.assertCurrent(state);
  expect(captures()).toBe(5);
});

it("still rejects source bytes edited between the pre-stage and currency checks", async () => {
  const { f, state, host } = await currentState();
  await host.prepareStage!("assessment", state);
  writeFileSync(resolve(f.root, "docs/specs/runtime.md"), "# Runtime\n\nEdited.\n");
  await expect(host.assertCurrent(state)).rejects.toMatchObject({ code: "source_bytes_changed" });
});
