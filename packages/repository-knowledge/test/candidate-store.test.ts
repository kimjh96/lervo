import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  calculateKnowledgeCompilationId,
  canonicalJson,
  loadKnowledgeCompilationCandidate,
  sha256,
  storeKnowledgeCompilationCandidate,
  type KnowledgeCompilationCandidate,
} from "../src/index.js";

const roots: string[] = [];

function candidate(): KnowledgeCompilationCandidate {
  const materials: Omit<KnowledgeCompilationCandidate, "schemaVersion" | "compilationId"> = {
    sourceSnapshotId: `ksnap_${"b".repeat(24)}`,
    source: {
      scannerBuild: "repository-scanner-v1",
      policyId: "knowledge.default",
      policyHash: `sha256:${"e".repeat(64)}`,
      partitionerBuild: "semantic-shards-v1",
    },
    compiler: {
      compilerId: "lervo.claude.semantic",
      compilerVersion: "1+fixture",
      compilerBuildId: `sha256:${"c".repeat(64)}`,
      provider: "claude",
      isolation: "external_no_capabilities",
    },
    shardIds: [`kshard_${"f".repeat(24)}`],
    inventoryCoverage: {
      included: 1,
      excluded: 0,
      unsupported: 0,
      includedBytes: 1,
      complete: true,
    },
    coverage: { shardCount: 1, compiledShardCount: 1, unitCount: 1, complete: true },
    coverageDigest: sha256(
      canonicalJson({
        inventoryCoverage: {
          included: 1,
          excluded: 0,
          unsupported: 0,
          includedBytes: 1,
          complete: true,
        },
        coverage: { shardCount: 1, compiledShardCount: 1, unitCount: 1, complete: true },
        shardIds: [`kshard_${"f".repeat(24)}`],
      }),
    ),
    concepts: [],
    relations: [],
  };
  return {
    schemaVersion: 1,
    compilationId: calculateKnowledgeCompilationId(materials),
    ...materials,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("semantic candidate store", () => {
  it("stores immutable unreviewed candidate bytes and reuses an identical artifact", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-candidate-store-"));
    roots.push(root);
    await applyInitPlan(
      await createInitPlan({
        root,
        projectId: "prj_candidatestore",
        now: new Date("2026-08-22T00:00:00.000Z"),
      }),
    );
    const first = await storeKnowledgeCompilationCandidate({
      repositoryRoot: root,
      candidate: candidate(),
    });
    const second = await storeKnowledgeCompilationCandidate({
      repositoryRoot: root,
      candidate: candidate(),
    });
    expect(first).toMatchObject({ created: true, assurance: "unreviewed" });
    expect(second).toMatchObject({ created: false, artifactHash: first.artifactHash });
    const stored = JSON.parse(
      await readFile(resolve(root, first.artifactPath), "utf8"),
    ) as KnowledgeCompilationCandidate;
    expect(stored.compiler.isolation).toBe("external_no_capabilities");
    expect(
      (
        await loadKnowledgeCompilationCandidate({
          repositoryRoot: root,
          compilationId: stored.compilationId,
        })
      ).artifactHash,
    ).toBe(first.artifactHash);
  });

  it("rejects a tampered artifact and a symlinked candidate directory", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-candidate-store-"));
    const outside = await mkdtemp(resolve(tmpdir(), "lervo-candidate-outside-"));
    roots.push(root, outside);
    await applyInitPlan(
      await createInitPlan({
        root,
        projectId: "prj_candidateunsafe",
        now: new Date("2026-08-22T00:00:00.000Z"),
      }),
    );
    const first = await storeKnowledgeCompilationCandidate({
      repositoryRoot: root,
      candidate: candidate(),
    });
    await writeFile(resolve(root, first.artifactPath), "{}\n");
    await expect(
      storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate: candidate() }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
    const directory = resolve(root, ".lervo/state/knowledge/candidates");
    await rm(directory, { recursive: true });
    await symlink(outside, directory, "dir");
    await expect(
      storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate: candidate() }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });
});
