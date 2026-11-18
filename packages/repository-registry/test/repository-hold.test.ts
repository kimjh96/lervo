import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  holdRepository,
  readRepositoryHold,
  readRepositoryHolds,
  releaseRepositoryHold,
} from "../src/repository-hold.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporary(): Promise<{ repository: string; holds: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-repository-hold-"));
  roots.push(root);
  const repository = resolve(root, "repository");
  await mkdir(repository);
  return { repository, holds: resolve(root, "state", "repository-holds.json") };
}

describe("the owner's repository hold (ADR-0561)", () => {
  it("holds and releases one repository in host state, keeping the first hold time", async () => {
    const { repository, holds } = await temporary();
    expect(await readRepositoryHold(repository, holds)).toBeNull();
    const first = await holdRepository({
      repositoryRoot: repository,
      reason: "deferred until the owner reviews it",
      now: new Date("2026-11-18T00:00:00Z"),
      path: holds,
    });
    expect(first).toMatchObject({
      reason: "deferred until the owner reviews it",
      heldAt: "2026-11-18T00:00:00.000Z",
    });
    const again = await holdRepository({
      repositoryRoot: `${repository}/`,
      reason: "later",
      now: new Date("2026-11-19T00:00:00Z"),
      path: holds,
    });
    expect(again).toMatchObject({ reason: "later", heldAt: "2026-11-18T00:00:00.000Z" });
    expect(await readRepositoryHolds(holds)).toHaveLength(1);
    expect(await readRepositoryHold(repository, holds)).toMatchObject({ reason: "later" });
    expect(JSON.parse(await readFile(holds, "utf8"))).toMatchObject({
      schemaVersion: 1,
      kind: "lervo_repository_holds",
    });
    expect(await releaseRepositoryHold({ repositoryRoot: repository, path: holds })).toMatchObject({
      reason: "later",
    });
    expect(await readRepositoryHold(repository, holds)).toBeNull();
    expect(await releaseRepositoryHold({ repositoryRoot: repository, path: holds })).toBeNull();
  });

  it("refuses an unsafe reason and fails closed on an unreadable hold file", async () => {
    const { repository, holds } = await temporary();
    await expect(
      holdRepository({ repositoryRoot: repository, reason: "two\nlines", path: holds }),
    ).rejects.toMatchObject({ code: "repository_hold_reason_invalid" });
    await mkdir(resolve(holds, ".."), { recursive: true });
    await writeFile(holds, "{ not json");
    // A lost hold could let Lervo apply an effect the owner deferred, so every repository counts
    // as held until the file is repaired.
    expect(await readRepositoryHold(repository, holds)).toMatchObject({
      reason: expect.stringContaining("unreadable"),
    });
    await expect(readRepositoryHolds(holds)).rejects.toMatchObject({
      code: "repository_hold_invalid",
    });
  });
});
