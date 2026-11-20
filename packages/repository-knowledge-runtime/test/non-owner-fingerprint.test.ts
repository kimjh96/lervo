import { execFile } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, expect, it } from "vitest";

import {
  convergenceRepositoryDigest,
  convergenceSourceFingerprint,
  nonOwnerRepositoryDigest,
} from "../src/source-fingerprint.js";
import { fixture } from "./fixture.js";

const execute = promisify(execFile);
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

/** Runs `observe` with no executable on PATH, so any Git process it spawned would fail. */
function withoutGit<T>(observe: () => T): T {
  const path = process.env.PATH;
  process.env.PATH = "";
  try {
    return observe();
  } finally {
    process.env.PATH = path;
  }
}

it("fences a non-owner on head, index and candidate shards without Git (ADR-0599)", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const digest = () => withoutGit(() => nonOwnerRepositoryDigest(f.root));
  const shard = resolve(f.root, ".lervo/state/knowledge/test-candidates/ab");
  await mkdir(shard, { recursive: true });
  await writeFile(resolve(shard, "kc_1.json"), '{"state":"pending"}\n');
  let last = digest();
  expect(digest()).toBe(last);
  // A working-tree edit is the owner's to inspect; the non-owner leaves it to the forced cycle.
  await writeFile(resolve(f.root, "README.md"), "# Repository\n\nEdited.\n");
  expect(digest()).toBe(last);
  // An entry rewritten in place is not walked; entries arrive by rename, which moves the shard.
  await writeFile(resolve(shard, "kc_1.json"), '{"state":"assessed"}\n');
  expect(digest()).toBe(last);
  await writeFile(resolve(f.root, ".lervo/state/kc_2.tmp"), '{"state":"pending"}\n');
  await rename(resolve(f.root, ".lervo/state/kc_2.tmp"), resolve(shard, "kc_2.json"));
  expect(digest()).not.toBe(last);
  last = digest();
  const git = (...args: string[]) =>
    execute("git", [
      "-C",
      f.root,
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@lervo.invalid",
      ...args,
    ]);
  await git("add", "README.md");
  expect(digest(), "staging moves the index").not.toBe(last);
  last = digest();
  await git("commit", "-m", "edit");
  expect(digest(), "a commit moves HEAD").not.toBe(last);
});

it("keeps the full digest for an owner and for a host without an ownership verdict", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const full = convergenceRepositoryDigest(f.root);
  const sourceDigest = (owner?: boolean) =>
    convergenceSourceFingerprint({
      repositoryRoot: f.root,
      events: f.events,
      ...(owner === undefined ? {} : { owner }),
    }).sourceDigest;
  expect(sourceDigest()).toBe(full);
  expect(sourceDigest(true)).toBe(full);
  expect(sourceDigest(false)).toBe(nonOwnerRepositoryDigest(f.root));
  expect(sourceDigest(false)).not.toBe(full);
});
