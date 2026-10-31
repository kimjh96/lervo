import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { scanDigest, upsertRepositoryKnowledgeScanSource } from "../src/scan-transforms.js";
import { compareScanPaths } from "../src/scan-priority.js";
import { SourceUnitCache } from "../src/source-unit-cache.js";
import {
  repositoryDocumentScanPriority,
  structuralMigrationCandidate,
} from "../src/document-layout.js";
import { defaultDecisionTaxonomy } from "@lervo/project";

import {
  assertCompleteRepositoryKnowledgeScan,
  defaultRepositoryKnowledgePolicy,
  scanRepositoryKnowledge,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(paths: string[]): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-scan-budget-"));
  roots.push(root);
  for (const path of paths) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(
      resolve(root, path),
      (path.endsWith(".ts") ? "export {};\n" : "# Source\n").padEnd(64),
    );
  }
  return root;
}

function scan(root: string, maxTotalBytes: number, maxFiles = 20_000, maxFileBytes = 1024) {
  return scanRepositoryKnowledge({
    repositoryRoot: root,
    projectId: "prj_scanbudgetfixture",
    policy: {
      ...defaultRepositoryKnowledgePolicy,
      limits: { maxTotalBytes, maxFiles, maxFileBytes },
    },
    observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
  });
}

const priorityPaths = [
  "z/AGENTS.md",
  ".agents/skills/example/SKILL.md",
  "docs/specifications/z.md",
  "src/z.ts",
  "a-research.md",
];
const classes = [
  "instructions",
  "portable_skills",
  "canonical_documents",
  "source_and_configuration",
  "other_documents",
];

describe("priority scan byte admission", () => {
  it.each([1, 2, 3, 4])(
    "admits the first %i priority classes before lower classes",
    async (count) => {
      const root = await repository([...priorityPaths].reverse());
      const result = await scan(root, count * 64);
      expect(result.coverage).toBe("partial");
      expect(result.skippedForBudget).toEqual({
        count: 5 - count,
        bytes: (5 - count) * 64,
        classes: classes.slice(count),
      });
      expect(
        result.sources
          .filter((source) => source.status === "included")
          .map((source) => source.path)
          .sort(),
      ).toEqual(priorityPaths.slice(0, count).sort());
      for (const path of priorityPaths.slice(count)) {
        const source = result.sources.find((item) => item.path === path);
        expect(source).toMatchObject({
          path,
          byteCount: 64,
          status: "unsupported",
          reason: "total_budget_exceeded",
          contentHash: null,
        });
        expect(source).not.toHaveProperty("content");
      }
      expect(result.inventoryCoverage).toMatchObject({
        complete: false,
        includedBytes: count * 64,
      });
    },
  );

  it("preserves instruction surfaces and portable resources when research overflows", async () => {
    const root = await repository([
      "AGENTS.md",
      "CLAUDE.md",
      "docs/instructions/rule.md",
      ".agents/skills/example/SKILL.md",
      ".agents/skills/example/resource.txt",
      "docs/research/large.md",
    ]);
    const result = await scan(root, 5 * 64);
    expect(result.sources.filter((source) => source.status === "included")).toHaveLength(5);
    expect(result.skippedForBudget).toEqual({ count: 1, bytes: 64, classes: ["other_documents"] });
  });

  it("is identical across repeated runs and file creation orders, using locale-neutral paths", async () => {
    const paths = ["docs/research/ä.md", "docs/research/a.md", "docs/research/Z.md"];
    const first = await repository(paths);
    const second = await repository([...paths].reverse());
    const result = await scan(first, 64);
    expect(await scan(first, 64)).toEqual(result);
    expect(await scan(second, 64)).toEqual(result);
    expect(result.sources.find((source) => source.status === "included")?.path).toBe(
      "docs/research/Z.md",
    );
  });

  it("continues with a later small file after a candidate does not fit", async () => {
    const root = await repository(["docs/research/a.md", "docs/research/b.md"]);
    await writeFile(resolve(root, "docs/research/a.md"), "x".repeat(80));
    const result = await scan(root, 64);
    expect(result.sources.find((source) => source.path.endsWith("b.md"))?.status).toBe("included");
    expect(result.skippedForBudget).toMatchObject({ count: 1, bytes: 80 });
  });

  it("reports complete coverage at the exact budget and keeps the per-file limit independent", async () => {
    const root = await repository(["AGENTS.md", "oversize.md"]);
    await writeFile(resolve(root, "oversize.md"), "x".repeat(65));
    const result = await scan(root, 64, 2, 64);
    expect(result.coverage).toBe("complete");
    expect(result.skippedForBudget).toEqual({ count: 0, bytes: 0, classes: [] });
    expect(result.sources.find((source) => source.path === "oversize.md")).toMatchObject({
      status: "unsupported",
      reason: "file_size_limit",
      byteCount: 65,
    });
  });

  it("uses the declared documentation root rather than hardcoded docs paths", async () => {
    const root = await repository(["manual/specifications/runtime.md", "manual/research/notes.md"]);
    await mkdir(resolve(root, ".lervo/knowledge"), { recursive: true });
    await writeFile(
      resolve(root, ".lervo/knowledge/document-layout.yaml"),
      JSON.stringify({
        ...defaultDecisionTaxonomy,
        decisionRoot: "manual/decisions",
      }),
    );
    const result = await scan(root, 64);
    expect(
      result.sources.find((source) => source.path === "manual/specifications/runtime.md")?.status,
    ).toBe("included");
    expect(
      result.sources.find((source) => source.path === "manual/research/notes.md")?.reason,
    ).toBe("total_budget_exceeded");
  });

  it("charges opaque skill resources, revision metadata, and supplemental evidence to the same budget", async () => {
    const root = await repository(["AGENTS.md"]);
    await mkdir(resolve(root, ".agents/skills/example"), { recursive: true });
    await writeFile(resolve(root, ".agents/skills/example/image.png"), Buffer.alloc(64));
    const result = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: "prj_scanbudgetfixture",
      policy: {
        ...defaultRepositoryKnowledgePolicy,
        limits: { maxFiles: 3, maxFileBytes: 64, maxTotalBytes: 128 },
      },
      observeRevision: async () => ({ status: "observed", content: "a".repeat(40) + "\n" }),
      supplementalSources: [
        {
          path: "@event/evt_budgetfixture",
          kind: "execution_event",
          unitKind: "event",
          classification: "ordinary",
          content: "evidence",
          adapter: "fixture.event",
          locator: "event",
          title: "Event",
          origin: "execution_event_store",
        },
      ],
    });
    expect(result.sources.find((source) => source.path.endsWith("image.png"))).toMatchObject({
      status: "included",
      reason: "opaque_portable_skill_resource",
      byteCount: 64,
    });
    const skipped = result.sources.filter((source) => source.reason === "total_budget_exceeded");
    expect(skipped.map((source) => source.kind).sort()).toEqual([
      "execution_event",
      "revision_metadata",
    ]);
    expect(
      skipped.every((source) => source.content === undefined && source.contentHash === null),
    ).toBe(true);
    expect(result.skippedForBudget).toEqual({ count: 2, bytes: 49, classes: ["other_documents"] });
    expect(result.inventoryCoverage.includedBytes).toBe(128);
  });

  it("still stops on maxFiles even when none of the bytes would fit", async () => {
    const root = await repository(["a.md", "b.md"]);
    await expect(scan(root, 1, 1)).rejects.toMatchObject({
      code: "knowledge_source_limit_exceeded",
    });
  });

  it("refuses currency and writes only compact private skipped-class evidence", async () => {
    const root = await repository(priorityPaths);
    const result = await scan(root, 64);
    expect(() => assertCompleteRepositoryKnowledgeScan(root, result)).toThrow(
      expect.objectContaining({ code: "knowledge_source_limit_exceeded" }),
    );
    const evidence = JSON.parse(
      await readFile(resolve(root, ".lervo/state/knowledge/scan-budget-stop.json"), "utf8"),
    );
    expect(evidence).toEqual({
      schemaVersion: 1,
      code: "knowledge_source_limit_exceeded",
      skippedForBudget: result.skippedForBudget,
    });
    expect(JSON.stringify(evidence)).not.toContain("a-research.md");
  });
});

it("does not charge extension-certain binaries or mark them as budget skips", async () => {
  const root = await repository(["AGENTS.md", "image.png"]);
  const result = await scan(root, 64);
  expect(result.coverage).toBe("complete");
  expect(result.inventoryCoverage.includedBytes).toBe(64);
  expect(result.skippedForBudget.count).toBe(0);
  expect(result.sources.find((source) => source.path === "image.png")).toMatchObject({
    status: "unsupported",
    reason: "binary_file",
    contentHash: null,
  });
});

it("matches a virtual update to a real rescan without changing legacy result ordering", async () => {
  const root = await repository(["docs/research/Z.md", "docs/research/a.md", "docs/research/ä.md"]);
  const before = await scan(root, 1024);
  const path = "docs/research/Z.md";
  const content = "# Updated\n\nExact replacement bytes.\n";
  const virtual = upsertRepositoryKnowledgeScanSource({ scan: before, path, content });
  await writeFile(resolve(root, path), content);
  const real = await scan(root, 1024);
  expect(real.sources.map((source) => source.path)).toEqual(
    before.sources.map((source) => source.path).sort((a, b) => a.localeCompare(b)),
  );
  expect(virtual.snapshotId).toBe(real.snapshotId);
  expect(virtual.contentSnapshotId).toBe(real.contentSnapshotId);
  expect(scanDigest(virtual)).toBe(scanDigest(real));
});

it("distinguishes a metadata-only budget skip even when the content digest matches", async () => {
  const root = await repository(["AGENTS.md"]);
  const input = {
    repositoryRoot: root,
    projectId: "prj_scanbudgetfixture",
    observeRevision: async () => ({ status: "observed" as const, content: "a".repeat(40) + "\n" }),
  };
  const complete = await scanRepositoryKnowledge({
    ...input,
    policy: {
      ...defaultRepositoryKnowledgePolicy,
      limits: { maxFiles: 10, maxFileBytes: 1024, maxTotalBytes: 105 },
    },
  });
  const partial = await scanRepositoryKnowledge({
    ...input,
    policy: {
      ...defaultRepositoryKnowledgePolicy,
      limits: { maxFiles: 10, maxFileBytes: 1024, maxTotalBytes: 64 },
    },
  });
  expect(complete.coverage).toBe("complete");
  expect(partial.coverage).toBe("partial");
  expect(partial.contentSnapshotId).toBe(complete.contentSnapshotId);
  expect(partial.snapshotId).not.toBe(complete.snapshotId);
  expect(scanDigest(partial)).not.toBe(scanDigest(complete));
  expect(() => assertCompleteRepositoryKnowledgeScan(root, partial)).toThrow(
    expect.objectContaining({ code: "knowledge_source_limit_exceeded" }),
  );
});

it("recomputes admission after a partial scan with a warm source-unit cache", async () => {
  const root = await repository(["AGENTS.md", "docs/research/large.md"]);
  const policy = {
    ...defaultRepositoryKnowledgePolicy,
    limits: { maxFiles: 10, maxFileBytes: 1024, maxTotalBytes: 100 },
  };
  const input = {
    repositoryRoot: root,
    projectId: "prj_scanbudgetfixture",
    policy,
    observeRevision: async () => ({
      status: "unavailable" as const,
      reason: "git_head_unavailable" as const,
    }),
  };
  const cache = new SourceUnitCache();
  const partial = await scanRepositoryKnowledge({ ...input, sourceUnitCache: cache });
  expect(partial.coverage).toBe("partial");
  const warm = new SourceUnitCache(cache.snapshot());
  await writeFile(resolve(root, "docs/research/large.md"), "# Now fits\n");
  const complete = await scanRepositoryKnowledge({ ...input, sourceUnitCache: warm });
  expect(complete.coverage).toBe("complete");
  expect(complete.skippedForBudget.count).toBe(0);
  expect(warm.statistics.reusedSources).toBeGreaterThan(0);
  expect(complete).toEqual(await scanRepositoryKnowledge(input));
});

it("shares canonical route recognition and prioritizes a role under research", () => {
  const taxonomy = {
    ...defaultDecisionTaxonomy,
    routes: [
      {
        id: "runtime",
        path: "runtime",
        priority: 100,
        description: "Runtime contracts and decisions.",
      },
    ],
    documentPolicy: {
      ...defaultDecisionTaxonomy.documentPolicy,
      roles: [
        {
          ...defaultDecisionTaxonomy.documentPolicy.roles[0]!,
          roleId: "publication_index",
          path: "docs/research/index.md",
        },
      ],
    },
  };
  expect(structuralMigrationCandidate("docs/runtime/contract.md", taxonomy)).toBe(false);
  expect(repositoryDocumentScanPriority("docs/runtime/contract.md", taxonomy)).toBe(
    "canonical_documents",
  );
  expect(repositoryDocumentScanPriority("docs/research/index.md", taxonomy)).toBe(
    "canonical_documents",
  );
  expect(repositoryDocumentScanPriority("docs/research/notes.md", taxonomy)).toBe(
    "other_documents",
  );
});

it("orders budget admission by Unicode code point, including astral paths", () => {
  expect(compareScanPaths("a.md", "a.md")).toBe(0);
  expect(compareScanPaths("docs/\uE000.md", "docs/\u{10000}.md")).toBeLessThan(0);
  expect(compareScanPaths("docs/a.md", "docs/Z.md")).toBeGreaterThan(0);
});
