import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { holdRepository, releaseRepositoryHold } from "@lervo/repository-registry";
import { afterEach, expect, it } from "vitest";

import type { ConvergenceContinuity } from "../src/convergence-continuity.js";
import { ConvergenceOwnership } from "../src/convergence-owner.js";
import type { KnowledgePublicationOutcome } from "../src/knowledge-publication.js";
import { startAutonomousKnowledgeWorker } from "../src/loop.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { FakeConvergenceOwnerHub, writeHostConfig } from "./convergence-owner-hosts.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
const previous = process.env.LERVO_USER_STATE_DIRECTORY;
const directories: string[] = [];
afterEach(async () => {
  if (previous === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = previous;
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("applies nothing while the owner holds the repository, then resumes on release (ADR-0561)", async () => {
  const state = await mkdtemp(resolve(tmpdir(), "lervo-owner-hold-state-"));
  directories.push(state);
  process.env.LERVO_USER_STATE_DIRECTORY = state;
  const f = await fixture(true);
  fixtures.push(f);
  await holdRepository({ repositoryRoot: f.root, reason: "later" });
  const run = () =>
    runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "held",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    });
  const head = f.events.latest()?.eventHash ?? null;
  expect(await run()).toEqual({ status: "busy", reason: "repository_owner_hold" });
  // No provider call, no event, and no repository write happened under the hold.
  await expect(readFile(f.log)).rejects.toMatchObject({ code: "ENOENT" });
  expect(f.events.latest()?.eventHash ?? null).toBe(head);
  await releaseRepositoryHold({ repositoryRoot: f.root });
  expect(await run()).not.toMatchObject({ reason: "repository_owner_hold" });
}, 60_000);

it("publishes nothing and reconciles no continuity while the owner holds the repository", async () => {
  const state = await mkdtemp(resolve(tmpdir(), "lervo-owner-hold-resident-"));
  directories.push(state);
  process.env.LERVO_USER_STATE_DIRECTORY = state;
  const f = await fixture(true);
  fixtures.push(f);
  await holdRepository({ repositoryRoot: f.root, reason: "later" });
  const lease = new FakeConvergenceOwnerHub(Date.now);
  await writeHostConfig(f.root, { hostId: `hst_${"3".repeat(32)}`, label: "mac", mode: "hub" });
  const ownership = new ConvergenceOwnership({
    storage: f.storage,
    provider: "claude",
    transport: async () => lease.port(),
  });
  // This host owns convergence, so only the hold keeps publication from running.
  expect(await ownership.observe()).toMatchObject({ role: "owner" });
  const calls = { publish: 0, continuity: 0 };
  const cycles: unknown[] = [];
  const stop = startAutonomousKnowledgeWorker({
    storage: f.storage,
    workerId: "held-resident",
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
    subscribe: () => () => undefined,
    onCycle: (result) => cycles.push(result),
    onFailure: () => undefined,
    intervalMilliseconds: 100,
    reconcileCeilingMilliseconds: 1_000,
    continuityTickMilliseconds: 50,
    ownership,
    // Publication can drop, repair, push, merge, and reset; continuity renews the delegation.
    publish: async () => {
      calls.publish += 1;
      return null as unknown as KnowledgePublicationOutcome;
    },
    continuity: {
      reconcile: async () => {
        calls.continuity += 1;
      },
    } as unknown as ConvergenceContinuity,
  });
  try {
    const deadline = Date.now() + 30_000;
    while (cycles.length === 0 && Date.now() < deadline)
      await new Promise((done) => setTimeout(done, 25));
    expect(cycles[0]).toEqual({ status: "busy", reason: "repository_owner_hold" });
    // Several continuity ticks and reconcile delays pass with the hold in place.
    await new Promise((done) => setTimeout(done, 1_500));
    expect(calls).toEqual({ publish: 0, continuity: 0 });
  } finally {
    await stop();
  }
}, 60_000);
