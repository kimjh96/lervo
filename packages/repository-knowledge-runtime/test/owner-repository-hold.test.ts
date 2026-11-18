import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { holdRepository, releaseRepositoryHold } from "@lervo/repository-registry";
import { afterEach, expect, it } from "vitest";

import { runAutonomousKnowledgeWorker } from "../src/worker.js";
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
