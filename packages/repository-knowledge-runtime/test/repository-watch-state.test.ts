import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import {
  readRepositoryWatchIssues,
  REPOSITORY_WATCH_STATE_DIRECTORY,
  repositoryWatchReporter,
} from "../src/repository-watch-state.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps each refused watch visible with a fix until that watch is armed (ADR-0602)", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-watch-state-"));
  roots.push(root);
  expect(await readRepositoryWatchIssues(root)).toEqual([]);
  const first = repositoryWatchReporter(root);
  const second = repositoryWatchReporter(root);
  await first.failed(Object.assign(new Error("watch"), { code: "ENOSPC" }));
  await second.failed(Object.assign(new Error("watch"), { code: "EMFILE" }));
  expect((await readRepositoryWatchIssues(root)).map((issue) => issue.errno).sort()).toEqual([
    "EMFILE",
    "ENOSPC",
  ]);
  expect(
    (await readRepositoryWatchIssues(root)).find((issue) => issue.errno === "ENOSPC"),
  ).toMatchObject({
    code: "repository_watch_unavailable",
    command: expect.stringContaining("fs.inotify.max_user_watches"),
  });
  // One watch arming never clears another's record.
  await first.armed();
  expect((await readRepositoryWatchIssues(root)).map((issue) => issue.errno)).toEqual(["EMFILE"]);
  await second.armed();
  expect(await readRepositoryWatchIssues(root)).toEqual([]);
  expect(await readdir(join(root, REPOSITORY_WATCH_STATE_DIRECTORY))).toEqual([]);
});
