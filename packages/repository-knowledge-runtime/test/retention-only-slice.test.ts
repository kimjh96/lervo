import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { observeProcessCost } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { acquireFullCycleAdmission } from "../src/full-cycle-admission.js";
import { runRetentionOnlySlice } from "../src/retention-only-slice.js";
import { fixture } from "./fixture.js";

// ADR-0660: a retention-only wake runs the retention slice and nothing else.
const execute = promisify(execFile);
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function slice(f: Awaited<ReturnType<typeof fixture>>, live = false) {
  return runRetentionOnlySlice({
    storage: f.storage,
    admissionDirectory: f.admissionDirectory,
    signal: new AbortController().signal,
    liveWorkPending: async () => live,
  });
}

it(
  "makes no provider call and runs no other stage, though work waits for the provider",
  { timeout: 60_000 },
  async () => {
    // Authorized, with convergence work queued: a full cycle here would call the provider.
    const f = await fixture(true);
    fixtures.push(f);
    const events = f.storage.events.list({ limit: 1_000 }).length;
    const observer = observeProcessCost();
    let outcome: Awaited<ReturnType<typeof slice>>;
    let scopes: string[];
    try {
      outcome = await slice(f);
      scopes = Object.keys(observer.snapshot().scopes);
    } finally {
      observer.close();
    }
    expect(outcome).toMatchObject({ kind: "slice", slice: { outcome: "ran" } });
    expect(scopes).toEqual(["artifact_retention"]);
    expect(await exists(resolve(f.directory, "provider-calls.jsonl"))).toBe(false);
    expect(f.storage.events.list({ limit: 1_000 })).toHaveLength(events);
    // The slice released the host admission: a full cycle is admitted at once.
    const admission = await acquireFullCycleAdmission({
      repositoryRoot: f.root,
      signal: AbortSignal.timeout(5_000),
      directory: f.admissionDirectory,
    });
    await admission.release();
  },
);

it(
  "never queues for the admission, never runs off the base branch or beside live work",
  { timeout: 60_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    expect(await slice(f, true)).toEqual({ kind: "live_work" });
    const held = await acquireFullCycleAdmission({
      repositoryRoot: resolve(f.directory, "another-repository"),
      signal: new AbortController().signal,
      directory: f.admissionDirectory,
    });
    try {
      expect(await slice(f)).toEqual({ kind: "admission_busy" });
      // It left no waiter behind, so the running full cycle is not asked to yield.
      expect(await held.contended()).toBe(false);
    } finally {
      await held.release();
    }
    await execute("git", ["-C", f.root, "checkout", "-q", "-b", "feature"]);
    expect(await slice(f)).toEqual({ kind: "off_base" });
  },
);
