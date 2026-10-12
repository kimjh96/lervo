import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import { terminalKnowledgeSnapshotId } from "../src/terminal-knowledge-snapshot.js";
import { captureTerminalRepositorySnapshot } from "../src/terminal-repository-snapshot.js";

const roots: string[] = [];
const cachePath = ".lervo/state/cache/terminal-knowledge-snapshot.json";

async function temporaryRoot() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-cache-"));
  roots.push(root);
  return root;
}

async function repository() {
  const root = await temporaryRoot();
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_snapshotcache" }));
  const snapshot = await captureTerminalRepositorySnapshot(root);
  return { root, revision: snapshot.revision, target: resolve(root, cachePath) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("terminal knowledge snapshot persistence", () => {
  it("does not follow an existing temporary symlink into unrelated bytes", async () => {
    const { root, revision, target } = await repository();
    const unrelated = resolve(await temporaryRoot(), "user.txt");
    await writeFile(unrelated, "keep user content\n");
    await symlink(unrelated, `${target}.${process.pid}.tmp`);
    expect(await terminalKnowledgeSnapshotId(root, revision)).toMatch(/^ksnap_[a-f0-9]{24}$/u);
    expect(await readFile(unrelated, "utf8")).toBe("keep user content\n");
  });

  it("removes owned temporary bytes after a failed replacement", async () => {
    const { root, revision, target } = await repository();
    await mkdir(target);
    expect(await terminalKnowledgeSnapshotId(root, revision)).toMatch(/^ksnap_[a-f0-9]{24}$/u);
    expect(
      (await readdir(resolve(root, ".lervo/state/cache"))).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    await expect(access(target)).resolves.toBeUndefined();
  });

  it("ignores a symbolic cache and preserves the linked content", async () => {
    const { root, revision, target } = await repository();
    const expected = await terminalKnowledgeSnapshotId(root, revision);
    const cache = JSON.parse(await readFile(target, "utf8"));
    const external = resolve(await temporaryRoot(), "cache.json");
    const content = JSON.stringify({ ...cache, sourceSnapshotId: `ksnap_${"f".repeat(24)}` });
    await writeFile(external, content);
    await rm(target);
    await symlink(external, target);
    expect(await terminalKnowledgeSnapshotId(root, revision)).toBe(expected);
    expect(await readFile(external, "utf8")).toBe(content);
  });

  it("sweeps only recognized abandoned temporary cache files", async () => {
    const { root, revision } = await repository();
    const directory = resolve(root, ".lervo/state/cache");
    const abandoned = ".terminal-knowledge-snapshot-00000000-0000-4000-8000-000000000000.tmp";
    const legacy = "terminal-knowledge-snapshot.json.123456.tmp";
    await writeFile(resolve(directory, abandoned), "partial cache");
    await writeFile(resolve(directory, legacy), "old partial cache");
    await writeFile(resolve(directory, "unrelated.tmp"), "keep");
    await terminalKnowledgeSnapshotId(root, revision);
    await expect(access(resolve(directory, abandoned))).rejects.toThrow();
    await expect(access(resolve(directory, legacy))).rejects.toThrow();
    expect(await readFile(resolve(directory, "unrelated.tmp"), "utf8")).toBe("keep");
  });

  it("computes fresh without writing through a symbolic cache ancestor", async () => {
    const { root, revision } = await repository();
    const external = await temporaryRoot();
    const directory = resolve(root, ".lervo/state/cache");
    await rm(directory, { recursive: true });
    await symlink(external, directory, "junction");
    expect(await terminalKnowledgeSnapshotId(root, revision)).toMatch(/^ksnap_[a-f0-9]{24}$/u);
    expect(await readdir(external)).toEqual([]);
  });

  it("treats an oversized cache as a miss and replaces it with bounded bytes", async () => {
    const { root, revision, target } = await repository();
    const expected = await terminalKnowledgeSnapshotId(root, revision);
    const cache = JSON.parse(await readFile(target, "utf8"));
    await writeFile(
      target,
      JSON.stringify({ ...cache, sourceSnapshotId: `ksnap_${"f".repeat(24)}` }) + " ".repeat(8192),
    );
    expect(await terminalKnowledgeSnapshotId(root, revision)).toBe(expected);
    expect((await readFile(target)).byteLength).toBeLessThanOrEqual(8192);
  });

  it("keeps concurrent producers disposable and the published cache complete", async () => {
    const { root, revision, target } = await repository();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => terminalKnowledgeSnapshotId(root, revision)),
    );
    expect(new Set(results).size).toBe(1);
    expect(JSON.parse(await readFile(target, "utf8"))).toMatchObject({
      repositoryRevision: revision,
      sourceSnapshotId: results[0],
    });
    expect(
      (await readdir(resolve(root, ".lervo/state/cache"))).filter(
        (name) => name.startsWith(".terminal-knowledge-snapshot-") && name.endsWith(".tmp"),
      ),
    ).toEqual([]);
  });
});
