import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, expect, it } from "vitest";

import { acquireFullCycleAdmission } from "../src/full-cycle-admission.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function directory() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-full-cycle-"));
  directories.push(path);
  return path;
}

it("never lets two residents hold the full-cycle admission together", async () => {
  const admission = await directory();
  const signal = new AbortController().signal;
  const holders: string[] = [];
  let concurrent = 0;
  let maximum = 0;
  await Promise.all(
    ["/repo/a", "/repo/b", "/repo/c"].map(async (repositoryRoot) => {
      const held = await acquireFullCycleAdmission({
        repositoryRoot,
        signal,
        directory: admission,
        pollMilliseconds: 10,
      });
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      holders.push(repositoryRoot);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
      concurrent--;
      await held.release();
    }),
  );
  expect(maximum).toBe(1);
  expect(holders.sort()).toEqual(["/repo/a", "/repo/b", "/repo/c"]);
});

it("reports contention, ends a wait on abort, and takes over a dead holder", async () => {
  const admission = await directory();
  const held = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/a",
    signal: new AbortController().signal,
    directory: admission,
  });
  const controller = new AbortController();
  let waited = false;
  const waiting = acquireFullCycleAdmission({
    repositoryRoot: "/repo/b",
    signal: controller.signal,
    directory: admission,
    pollMilliseconds: 10,
    onWait: () => {
      waited = true;
    },
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  expect(waited).toBe(true);
  controller.abort();
  await expect(waiting).rejects.toMatchObject({ code: "knowledge_cancelled" });
  await held.release();

  const db = new DatabaseSync(resolve(admission, "full-cycle-admission.sqlite"));
  db.prepare("INSERT OR REPLACE INTO holder VALUES(1,?,?,?,?,?)").run(
    2_147_483_646,
    "dead",
    "sha256:dead",
    Date.now(),
    Date.now() + 600_000,
  );
  db.close();
  const recovered = await acquireFullCycleAdmission({
    repositoryRoot: "/repo/c",
    signal: new AbortController().signal,
    directory: admission,
  });
  await recovered.release();
});
