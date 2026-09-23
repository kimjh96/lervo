import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  compareRepositoryWork,
  observeRepositoryWork,
} from "../src/repository-work-observation.js";
import { inspectRepositoryWorkSourceCurrency } from "../src/repository-work-source-currency.js";
import { prepareRepositoryWorkSourceManifest } from "../src/repository-work-source-manifest.js";

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-source-currency-"));
  roots.push(root);
  await execute("git", ["init", "-b", "main"], { cwd: root });
  await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
  await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
  await writeFile(resolve(root, "README.md"), "before\n");
  await execute("git", ["add", "README.md"], { cwd: root });
  await execute("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

describe("repository work source currency", () => {
  it("accepts exact current dirty bytes and detects later source drift", async () => {
    const root = await repository();
    const before = await observeRepositoryWork(root);
    await writeFile(resolve(root, "README.md"), "after\n");
    const after = await observeRepositoryWork(root);
    const change = await compareRepositoryWork({ repositoryRoot: root, before, after });
    const manifest = prepareRepositoryWorkSourceManifest({ before, after, change }).manifest;
    expect(await inspectRepositoryWorkSourceCurrency({ repositoryRoot: root, manifest })).toEqual({
      status: "ready_for_review",
      changedPathCount: 1,
    });
    await writeFile(resolve(root, "README.md"), "later\n");
    expect(await inspectRepositoryWorkSourceCurrency({ repositoryRoot: root, manifest })).toEqual({
      status: "stale",
      changedPathCount: 1,
      reasonCode: "source_bytes_changed",
    });
  });

  it("accepts a later clean commit only when the exact changed path still has the bound Git object", async () => {
    const root = await repository();
    const before = await observeRepositoryWork(root);
    await writeFile(resolve(root, "README.md"), "after\n");
    await execute("git", ["add", "README.md"], { cwd: root });
    await execute("git", ["commit", "-m", "change readme"], { cwd: root });
    const after = await observeRepositoryWork(root);
    const change = await compareRepositoryWork({ repositoryRoot: root, before, after });
    const manifest = prepareRepositoryWorkSourceManifest({ before, after, change }).manifest;
    await writeFile(resolve(root, "OTHER.md"), "unrelated\n");
    await execute("git", ["add", "OTHER.md"], { cwd: root });
    await execute("git", ["commit", "-m", "unrelated"], { cwd: root });
    expect(await inspectRepositoryWorkSourceCurrency({ repositoryRoot: root, manifest })).toEqual({
      status: "ready_for_review",
      changedPathCount: 1,
    });
    await writeFile(resolve(root, "README.md"), "later\n");
    expect(
      await inspectRepositoryWorkSourceCurrency({ repositoryRoot: root, manifest }),
    ).toMatchObject({
      status: "stale",
      reasonCode: "source_bytes_changed",
    });
  });

  it("requires review when the pre-turn dirty bytes cannot be reconstructed", async () => {
    const root = await repository();
    await writeFile(resolve(root, "README.md"), "dirty before\n");
    const before = await observeRepositoryWork(root);
    await writeFile(resolve(root, "README.md"), "dirty after\n");
    const after = await observeRepositoryWork(root);
    const change = await compareRepositoryWork({ repositoryRoot: root, before, after });
    const manifest = prepareRepositoryWorkSourceManifest({ before, after, change }).manifest;
    expect(await inspectRepositoryWorkSourceCurrency({ repositoryRoot: root, manifest })).toEqual({
      status: "needs_review",
      changedPathCount: 1,
      reasonCode: "before_bytes_unavailable",
    });
    const unsafe = structuredClone(manifest);
    unsafe.paths[0]!.path = "../secret.txt";
    expect(
      await inspectRepositoryWorkSourceCurrency({ repositoryRoot: root, manifest: unsafe }),
    ).toEqual({
      status: "needs_review",
      changedPathCount: 0,
      reasonCode: "source_evidence_unavailable",
    });
  });

  it("reads a newly added nested source from its absent before-tree coordinate", async () => {
    const root = await repository();
    const before = await observeRepositoryWork(root);
    await mkdir(resolve(root, "src"));
    await writeFile(resolve(root, "src/new.ts"), "export const value = 1;\n");
    const after = await observeRepositoryWork(root);
    const change = await compareRepositoryWork({ repositoryRoot: root, before, after });
    const manifest = prepareRepositoryWorkSourceManifest({ before, after, change }).manifest;
    expect(await inspectRepositoryWorkSourceCurrency({ repositoryRoot: root, manifest })).toEqual({
      status: "ready_for_review",
      changedPathCount: 1,
    });
  });
});
