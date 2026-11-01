import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertCompleteRepositoryKnowledgeScan,
  defaultRepositoryKnowledgePolicy,
  readObservedSourceText,
  scanDigest,
  scanRepositoryKnowledge,
  upsertRepositoryKnowledgeScanSource,
} from "../src/index.js";
import { observeRepositoryDocumentStaleness } from "../src/document-staleness-state.js";
import { scanRetentionDigest } from "../src/scan-retention.js";
import { SourceUnitCache } from "../src/source-unit-cache.js";
import type { RepositorySupplementalSource } from "../src/types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const documents = {
  "AGENTS.md": "# Agents\n\nRead the specification.\n",
  "docs/specifications/runtime.md": "# Runtime\n\n## Local\n\nRuns locally.\n",
  "docs/research/notes.md": "# Notes\n\n## Finding\n\nObserved.\n",
};
// A byte-order mark and multi-byte text make the whole-file range differ from naive byte counts.
const code = {
  "src/a.ts": "﻿export function café(): string {\n  return 'é';\n}\n",
  "src/b.ts": "export const answer = 42;\n",
  "config.json": '{"enabled":true,"nested":{"value":1}}\n',
};
const evidence: RepositorySupplementalSource = {
  path: "@event/evt_retentionfixture",
  kind: "execution_event",
  unitKind: "event",
  classification: "ordinary",
  content: "event evidence bytes\n",
  adapter: "fixture.event",
  locator: "event",
  title: "Event",
  origin: "execution_event_store",
};
const bytes = (files: Record<string, string>) =>
  Object.values(files).reduce((total, value) => total + Buffer.byteLength(value), 0);
const documentBytes = bytes(documents);
const codeBytes = bytes(code);

async function repository(files: Record<string, string> = { ...documents, ...code }) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-scan-retention-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    await writeFile(resolve(root, path), content);
  }
  return root;
}

function scan(root: string, maxTotalBytes: number, sourceUnitCache?: SourceUnitCache) {
  return scanRepositoryKnowledge({
    repositoryRoot: root,
    projectId: "prj_scanretention",
    policy: {
      ...defaultRepositoryKnowledgePolicy,
      limits: { maxFiles: 100, maxFileBytes: 4096, maxTotalBytes },
    },
    observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
    supplementalSources: [evidence],
    ...(sourceUnitCache === undefined ? {} : { sourceUnitCache }),
  });
}

const retained = (result: Awaited<ReturnType<typeof scan>>) =>
  result.sources.filter((source) => source.content !== undefined).map((source) => source.path);
const observed = (result: Awaited<ReturnType<typeof scan>>) =>
  result.sources
    .filter((source) => source.contentRetention === "observed_only")
    .map((source) => source.path);

describe("observe every source and budget only retained content", () => {
  it("completes when code and evidence exceed the budget but documents fit", async () => {
    const root = await repository();
    const full = await scan(root, 1024 * 1024);
    const budgeted = await scan(root, documentBytes);
    expect(full.coverage).toBe("complete");
    expect(full.retention.observedOnly.count).toBe(0);
    expect(budgeted.coverage).toBe("complete");
    expect(budgeted.inventoryCoverage.complete).toBe(true);
    expect(() => assertCompleteRepositoryKnowledgeScan(root, budgeted)).not.toThrow();
    expect(budgeted.retention).toEqual({
      observedOnly: {
        count: 4,
        bytes: codeBytes + Buffer.byteLength(evidence.content),
        classes: ["source_and_configuration", "execution_evidence"],
      },
    });
    expect(budgeted.skippedForBudget).toEqual(budgeted.retention.observedOnly);
    expect(budgeted.inventoryCoverage.includedBytes).toBe(full.inventoryCoverage.includedBytes);
    for (const source of budgeted.sources.filter((item) => item.status === "included")) {
      const reference = full.sources.find((item) => item.path === source.path)!;
      expect(source.contentHash).toBe(reference.contentHash);
      expect(source.byteCount).toBe(reference.byteCount);
    }
    for (const path of observed(budgeted)) {
      const source = budgeted.sources.find((item) => item.path === path)!;
      expect(source).not.toHaveProperty("content");
      const units = budgeted.units.filter((unit) => unit.sourceId === source.sourceId);
      expect(units).toHaveLength(1);
      const wholeSource = full.units.find(
        (unit) => unit.sourceId === source.sourceId && ["file", "event"].includes(unit.unitKind),
      );
      expect(units[0]).toEqual(wholeSource);
    }
    // The retained read of code has inner units that the observed-only read never extracts.
    expect(full.units.some((unit) => unit.path === "src/a.ts" && unit.unitKind !== "file")).toBe(
      true,
    );
    expect(JSON.stringify(budgeted.sources)).not.toContain("event evidence bytes");
  });

  it("retains documents before code and evidence after code, deterministically", async () => {
    const root = await repository();
    const documentsOnly = await scan(root, documentBytes);
    expect(retained(documentsOnly).sort()).toEqual(Object.keys(documents).sort());
    const withCode = await scan(root, documentBytes + codeBytes);
    expect(observed(withCode)).toEqual([evidence.path]);
    expect(withCode.retention.observedOnly.classes).toEqual(["execution_evidence"]);
    expect(await scan(root, documentBytes + codeBytes)).toEqual(withCode);
    const partialCode = await scan(root, documentBytes + Buffer.byteLength(code["config.json"]));
    // Code-point order inside the class: `config.json` precedes `src/`.
    expect(observed(partialCode).sort()).toEqual([evidence.path, "src/a.ts", "src/b.ts"].sort());
  });

  it("stops currency claims when documents alone exceed the budget", async () => {
    const root = await repository();
    const result = await scan(root, documentBytes - 1);
    expect(result.coverage).toBe("partial");
    expect(result.retention.observedOnly.classes).toContain("other_documents");
    expect(
      result.sources.every((source) => source.status !== "included" || source.contentHash),
    ).toBe(true);
    expect(() => assertCompleteRepositoryKnowledgeScan(root, result)).toThrow(
      expect.objectContaining({ code: "knowledge_source_limit_exceeded" }),
    );
  });

  it("changes the hash and whole-file unit version of an edited observed-only file", async () => {
    const root = await repository();
    const before = await scan(root, documentBytes);
    await writeFile(resolve(root, "src/b.ts"), "export const answer = 43;\n");
    const after = await scan(root, documentBytes);
    const unitOf = (result: typeof before) =>
      result.units.find((unit) => unit.path === "src/b.ts" && unit.unitKind === "file")!;
    expect(after.coverage).toBe("complete");
    expect(unitOf(after).unitId).toBe(unitOf(before).unitId);
    expect(unitOf(after).unitVersionId).not.toBe(unitOf(before).unitVersionId);
    expect(after.sources.find((source) => source.path === "src/b.ts")?.contentHash).not.toBe(
      before.sources.find((source) => source.path === "src/b.ts")?.contentHash,
    );
  });

  it("keeps a virtually updated observed-only source equal to a real rescan", async () => {
    const root = await repository();
    const before = await scan(root, documentBytes);
    const content = "export const answer = 44;\n";
    const virtual = upsertRepositoryKnowledgeScanSource({
      scan: before,
      path: "src/b.ts",
      content,
    });
    await writeFile(resolve(root, "src/b.ts"), content);
    const real = await scan(root, documentBytes);
    expect(virtual.sources.find((source) => source.path === "src/b.ts")).not.toHaveProperty(
      "content",
    );
    expect(scanDigest(virtual)).toBe(scanDigest(real));
  });

  it("never lets the source-unit cache cross between observed-only and retained reads", async () => {
    const root = await repository();
    const budget = documentBytes + codeBytes;
    const notes = "docs/research/notes.md";
    const cold = () => scan(root, budget);
    const first = new SourceUnitCache();
    const retainedScan = await scan(root, budget, first);
    expect(observed(retainedScan)).toEqual([evidence.path]);
    // The same policy now retains the grown document instead of the code.
    await writeFile(
      resolve(root, notes),
      documents[notes].padEnd(documents[notes].length + codeBytes - 1, "n"),
    );
    const second = new SourceUnitCache(first.snapshot());
    const observedScan = await scan(root, budget, second);
    expect(observed(observedScan)).toContain("src/a.ts");
    expect(observedScan).toEqual(await cold());
    expect(second.statistics.reusedSources).toBe(Object.keys(documents).length - 1);
    expect(observedScan.units.filter((unit) => unit.path === "src/a.ts")).toHaveLength(1);
    // Observed-only sources neither consult nor create entries.
    expect(second.snapshot()?.entries).toHaveLength(Object.keys(documents).length);
    await writeFile(resolve(root, notes), documents[notes]);
    const third = new SourceUnitCache(second.snapshot());
    expect(await scan(root, budget, third)).toEqual(retainedScan);
    expect(third.statistics.recomputedSources).toBe(Object.keys(code).length + 1);
    expect(scanRetentionDigest(observedScan)).not.toBe(scanRetentionDigest(retainedScan));
  });

  it("binds the staleness projection to the retention digest", async () => {
    const root = await repository({
      ...documents,
      ".lervo/knowledge/policy.yaml": JSON.stringify(defaultRepositoryKnowledgePolicy),
    });
    let evaluations = 0;
    const observe = (retentionDigest: string) =>
      observeRepositoryDocumentStaleness({
        root,
        mode: "evaluate_and_record",
        retentionDigest,
        coverage: "complete",
        documents: [],
        normalizationRecords: [],
        ignored: () => false,
        topLevel: () => true,
        now: new Date("2026-11-01T00:00:00.000Z"),
        git: {
          headRevision: async () => "a".repeat(40),
          latestPathRevisions: async () => {
            evaluations += 1;
            return new Map();
          },
          objectNames: async () => new Map(),
        },
      });
    await observe("sha256:retained");
    await observe("sha256:retained");
    expect(evaluations).toBe(1);
    await observe("sha256:observed");
    expect(evaluations).toBe(2);
  });

  it("rereads an observed-only file only while it still matches its observed hash", async () => {
    const root = await repository();
    const result = await scan(root, documentBytes);
    const source = result.sources.find((item) => item.path === "src/a.ts")!;
    expect(await readObservedSourceText(root, source)).toBe(code["src/a.ts"].slice(1));
    await writeFile(resolve(root, "src/a.ts"), code["src/a.ts"].replace("é'", "e'"));
    await expect(readObservedSourceText(root, source)).rejects.toMatchObject({
      code: "source_bytes_changed",
    });
    await expect(
      readObservedSourceText(
        root,
        result.sources.find((item) => item.path === evidence.path)!,
      ),
    ).rejects.toMatchObject({ code: "knowledge_source_unsafe" });
  });
});

describe("data files are not knowledge (ADR-0544)", () => {
  it("observes logs and unrecognized text files like code, so they never make coverage partial", async () => {
    const root = await repository({
      ...documents,
      "fixtures/part.step": `ISO-10303-21;\n${"DATA;\n".repeat(200)}`,
      "logs/run.log": `${"line\n".repeat(200)}`,
    });
    const result = await scan(root, documentBytes + 64);
    expect(observed(result)).toEqual(
      expect.arrayContaining(["fixtures/part.step", "logs/run.log"]),
    );
    expect(result.coverage).toBe("complete");
    expect(result.retention.observedOnly.classes).not.toContain("other_documents");
    expect(retained(result)).toEqual(expect.arrayContaining(Object.keys(documents)));
    expect(() => assertCompleteRepositoryKnowledgeScan(root, result)).not.toThrow();
  });
});
