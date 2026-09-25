import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  compareRepositoryWork,
  observeRepositoryWork,
  RepositoryWorkObservationLimitError,
} from "../src/repository-work-observation.js";

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository work observation", () => {
  it("derives revisions and paths from the same non-ignored Git observation", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-repository-work-observation-"));
    roots.push(root);
    await execute("git", ["init", "-b", "main"], { cwd: root });
    await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
    await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
    await writeFile(resolve(root, ".gitignore"), "docs/knowledge/\n");
    await writeFile(resolve(root, "README.md"), "before\n");
    await execute("git", ["add", ".gitignore", "README.md"], { cwd: root });
    await execute("git", ["commit", "-m", "fixture"], { cwd: root });

    const before = await observeRepositoryWork(root);
    await mkdir(resolve(root, "docs/knowledge"), { recursive: true });
    await writeFile(resolve(root, "docs/knowledge/index.md"), "rebuilt\n");
    const afterIgnoredProjection = await observeRepositoryWork(root);

    expect(
      await compareRepositoryWork({
        repositoryRoot: root,
        before,
        after: afterIgnoredProjection,
      }),
    ).toEqual({
      repositoryRevisionBefore: before.revision,
      repositoryRevisionAfter: before.revision,
      changedPaths: [],
    });

    await writeFile(resolve(root, "README.md"), "after\n");
    const afterTrackedChange = await observeRepositoryWork(root);
    const changed = await compareRepositoryWork({
      repositoryRoot: root,
      before,
      after: afterTrackedChange,
    });
    expect(changed.repositoryRevisionBefore).toBe(before.revision);
    expect(changed.repositoryRevisionAfter).not.toBe(before.revision);
    expect(changed.changedPaths).toEqual(["README.md"]);
  });

  it("rejects a changed-path set that cannot fit the canonical completion event", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-repository-work-bound-"));
    roots.push(root);
    await execute("git", ["init", "-b", "main"], { cwd: root });
    await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
    await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
    await writeFile(resolve(root, "README.md"), "before\n");
    await execute("git", ["add", "README.md"], { cwd: root });
    await execute("git", ["commit", "-m", "fixture"], { cwd: root });

    const before = await observeRepositoryWork(root);
    for (let index = 0; index < 65; index += 1) {
      await writeFile(resolve(root, `change-${index}.txt`), `${index}\n`);
    }
    const after = await observeRepositoryWork(root);

    await expect(
      compareRepositoryWork({ repositoryRoot: root, before, after }),
    ).rejects.toMatchObject({
      name: RepositoryWorkObservationLimitError.name,
      code: "repository_changed_path_limit_exceeded",
    });
  });

  it("rejects a Git observation that exceeds its inventory bound", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-repository-observation-bound-"));
    roots.push(root);
    await execute("git", ["init", "-b", "main"], { cwd: root });
    await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
    await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
    await writeFile(resolve(root, "README.md"), "before\n");
    await execute("git", ["add", "README.md"], { cwd: root });
    await execute("git", ["commit", "-m", "fixture"], { cwd: root });

    for (let index = 0; index < 1_025; index += 1) {
      await writeFile(resolve(root, `change-${index}.txt`), `${index}\n`);
    }

    await expect(observeRepositoryWork(root)).rejects.toMatchObject({
      code: "repository_changed_path_limit_exceeded",
    });
  });

  it("does not count untracked Lervo projections toward repository work", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-repository-observation-projection-"));
    roots.push(root);
    await execute("git", ["init", "-b", "main"], { cwd: root });
    await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
    await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
    await writeFile(resolve(root, "README.md"), "before\n");
    await execute("git", ["add", "README.md"], { cwd: root });
    await execute("git", ["commit", "-m", "fixture"], { cwd: root });
    const evidence = resolve(root, ".lervo/generated/verification/pilot");
    await mkdir(evidence, { recursive: true });
    for (let index = 0; index < 1_100; index += 1)
      await writeFile(resolve(evidence, `evidence-${index}.json`), `${index}\n`);

    const before = await observeRepositoryWork(root);
    expect([...before.paths.keys()]).toEqual([]);
    await writeFile(resolve(root, "README.md"), "after\n");
    const changed = await compareRepositoryWork({
      repositoryRoot: root,
      before,
      after: await observeRepositoryWork(root),
    });
    expect(changed.changedPaths).toEqual(["README.md"]);
  });
});
