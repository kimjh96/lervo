import { createHash } from "node:crypto";
import {
  lstat,
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

import type { DocumentRegistry } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDocumentMigrationDryRun,
  type DocumentImportAdapter,
} from "../src/index.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-documents-"));
  roots.push(root);
  return root;
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function legacyRegistry(): DocumentRegistry {
  return {
    schemaVersion: 1,
    documents: {
      doc_legacy_000001: {
        path: "README.md",
        kind: "canonical",
        responsibleParty: { kind: "team", id: "maintainers" },
        connectedPaths: ["src"],
        verifiedRevision: "git:legacy",
        verifiedAt: "2026-08-19T00:00:00Z",
        reviewIntervalDays: 30,
        ownership: { mode: "user" },
      },
    },
  };
}

async function treeSnapshot(root: string, current = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = resolve(current, entry.name);
    const path = absolute.slice(root.length + 1).split("\\").join("/");
    if (entry.isDirectory()) Object.assign(result, await treeSnapshot(root, absolute));
    else if (entry.isFile()) result[path] = hash(await readFile(absolute));
    else result[path] = `other:${entry.name}`;
  }
  return result;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("document migration discovery", () => {
  it("creates per-source candidates without changing legacy, Markdown, or unknown originals", async () => {
    const root = await temporaryRoot();
    await mkdir(resolve(root, ".lervo"));
    await mkdir(resolve(root, "docs"));
    await writeFile(resolve(root, "README.md"), "# Project\n\nHuman-authored source.\n");
    await writeFile(resolve(root, "docs", "notes.txt"), "custom document bytes\n");
    await writeFile(
      resolve(root, ".lervo", "documents.yaml"),
      `${JSON.stringify(legacyRegistry(), null, 2)}\n`,
    );
    const before = await treeSnapshot(root);

    const result = await createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["docs", "README.md", ".lervo/documents.yaml"],
      generatedAt: "2026-08-19T00:00:00Z",
    });

    expect(result.plan).toMatchObject({
      mode: "dry_run",
      writesAllowed: false,
      approvalStatus: "not_requested",
      outcome: "conflict",
      warnings: expect.arrayContaining(["duplicate_document_proposal", "observed_source"]),
    });
    expect(result.plan.sources.map((source) => source.path)).toEqual([
      ".lervo/documents.yaml",
      "README.md",
      "docs/notes.txt",
    ]);
    expect(result.candidateArtifacts.map((artifact) => artifact.candidate.source.formatId))
      .toEqual(["lervo_legacy_registry", "markdown", "unknown"]);
    expect(result.candidateArtifacts.map((artifact) => artifact.candidate.importer))
      .toEqual([
        { adapterId: "lervo_legacy_registry", version: "1.0.0" },
        { adapterId: "markdown", version: "1.1.0" },
        { adapterId: "lervo_unknown", version: "1.0.0" },
      ]);
    expect(result.candidateArtifacts).toHaveLength(3);
    for (const artifact of result.candidateArtifacts) {
      const bytes = result.candidateArtifactBytes.get(artifact.artifactId);
      expect(bytes).toBeDefined();
      expect(hash(bytes as Uint8Array)).toBe(artifact.contentHash);
      expect(bytes?.byteLength).toBe(artifact.byteCount);
    }
    expect(await treeSnapshot(root)).toEqual(before);
    await expect(lstat(resolve(root, ".lervo", "documents"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("is deterministic and binds the plan identity to current source bytes", async () => {
    const root = await temporaryRoot();
    await writeFile(resolve(root, "a.md"), "# A\n");
    await writeFile(resolve(root, "b.md"), "# B\n");
    const first = await createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["b.md", "a.md"],
      generatedAt: "2026-08-19T00:00:00Z",
    });
    const second = await createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["a.md", "b.md"],
      generatedAt: "2026-08-19T01:00:00Z",
    });
    expect(second.plan.planId).toBe(first.plan.planId);
    expect(second.plan.sources).toEqual(first.plan.sources);
    expect(second.plan.candidates).toEqual(first.plan.candidates);

    await writeFile(resolve(root, "a.md"), "# A changed\n");
    const changed = await createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["a.md", "b.md"],
      generatedAt: "2026-08-19T02:00:00Z",
    });
    expect(changed.plan.planId).not.toBe(first.plan.planId);
    expect(changed.plan.sources[0]?.contentHash).not.toBe(first.plan.sources[0]?.contentHash);
  });

  it("does not treat a legacy registry reference as a scanned document", async () => {
    const root = await temporaryRoot();
    await mkdir(resolve(root, ".lervo"));
    await writeFile(
      resolve(root, ".lervo", "documents.yaml"),
      `${JSON.stringify(legacyRegistry())}\n`,
    );
    const result = await createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: [".lervo/documents.yaml"],
      generatedAt: "2026-08-19T00:00:00Z",
    });
    expect(result.plan).toMatchObject({
      outcome: "review_required",
      warnings: expect.arrayContaining(["referenced_document_not_scanned"]),
    });
    expect(result.plan.sources.map((source) => source.path)).toEqual([
      ".lervo/documents.yaml",
    ]);
  });

  it("records existing and unsafe sidecar targets as conflicts without overwriting them", async () => {
    const root = await temporaryRoot();
    await writeFile(resolve(root, "README.md"), "# Existing target\n");
    const first = await createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["README.md"],
      generatedAt: "2026-08-19T00:00:00Z",
    });
    const target = first.plan.candidates[0]?.target;
    expect(target).not.toBeNull();
    await mkdir(resolve(root, ".lervo", "documents"), { recursive: true });
    const targetPath = resolve(root, (target as { path: string }).path);
    await writeFile(targetPath, "user-owned sidecar bytes\n");

    const existing = await createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["README.md"],
      generatedAt: "2026-08-19T00:00:00Z",
    });
    expect(existing.plan).toMatchObject({ outcome: "conflict", warnings: ["candidate_review_required", "target_exists"] });
    expect(existing.plan.candidates[0]?.target).toMatchObject({
      expected: { kind: "file", contentHash: hash(await readFile(targetPath)) },
    });
    expect(await readFile(targetPath, "utf8")).toBe("user-owned sidecar bytes\n");

    await rm(targetPath);
    await rm(resolve(root, ".lervo", "documents"), { recursive: true });
    const outside = await temporaryRoot();
    await symlink(outside, resolve(root, ".lervo", "documents"));
    const unsafe = await createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["README.md"],
      generatedAt: "2026-08-19T00:00:00Z",
    });
    expect(unsafe.plan).toMatchObject({ outcome: "conflict", warnings: ["candidate_review_required", "target_unsafe"] });
    expect(unsafe.plan.candidates[0]?.target).toMatchObject({
      expected: { kind: "unsafe", reasonCode: "target_unsafe" },
    });
  });

  it("fails closed on source links and bounded scans", async () => {
    const root = await temporaryRoot();
    await writeFile(resolve(root, "source.md"), "# Source\n");
    await symlink(resolve(root, "source.md"), resolve(root, "linked.md"));
    await expect(createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["linked.md"],
      generatedAt: "2026-08-19T00:00:00Z",
    })).rejects.toMatchObject({ code: "unsafe_source" });
    await expect(createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["source.md"],
      limits: { maximumFileBytes: 4 },
      generatedAt: "2026-08-19T00:00:00Z",
    })).rejects.toMatchObject({ code: "scan_limit_exceeded" });
  });

  it("does not enter repository metadata, dependencies, state, or configured exclusions", async () => {
    const root = await temporaryRoot();
    await mkdir(resolve(root, ".git"));
    await mkdir(resolve(root, "node_modules", "fixture"), { recursive: true });
    await mkdir(resolve(root, ".lervo", "state"), { recursive: true });
    await mkdir(resolve(root, "private"));
    await writeFile(resolve(root, ".git", "internal.md"), "# Git\n");
    await writeFile(resolve(root, "node_modules", "fixture", "README.md"), "# Dependency\n");
    await writeFile(resolve(root, ".lervo", "state", "trace.md"), "# State\n");
    await writeFile(resolve(root, "private", "notes.md"), "# Private\n");
    await writeFile(resolve(root, "README.md"), "# Included\n");

    const result = await createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["."],
      excludePaths: ["private"],
      generatedAt: "2026-08-19T00:00:00Z",
    });
    expect(result.plan.sources.map((source) => source.path)).toEqual(["README.md"]);
  });

  it("rejects ambiguous adapters and adapters that mutate isolated input bytes", async () => {
    const root = await temporaryRoot();
    await writeFile(resolve(root, "README.md"), "# Adapter contract\n");
    const draft = {
      formatId: "custom",
      disposition: "observed" as const,
      confidence: "none" as const,
      detectedOwnership: "unknown" as const,
      proposal: null,
      warnings: ["unsupported_format"],
    };
    const first: DocumentImportAdapter = {
      descriptor: { adapterId: "first", version: "1.0.0" },
      supports: () => true,
      inspect: () => [draft],
    };
    const second: DocumentImportAdapter = {
      descriptor: { adapterId: "second", version: "1.0.0" },
      supports: () => true,
      inspect: () => [draft],
    };
    await expect(createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["README.md"],
      adapters: [first, second],
      generatedAt: "2026-08-19T00:00:00Z",
    })).rejects.toMatchObject({ code: "ambiguous_import_adapter" });

    const mutating: DocumentImportAdapter = {
      descriptor: { adapterId: "mutating", version: "1.0.0" },
      supports: () => true,
      inspect: (source) => {
        source.bytes[0] = 0;
        return [draft];
      },
    };
    await expect(createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["README.md"],
      adapters: [mutating],
      generatedAt: "2026-08-19T00:00:00Z",
    })).rejects.toMatchObject({ code: "invalid_adapter_contract" });
    expect(await readFile(resolve(root, "README.md"), "utf8")).toBe("# Adapter contract\n");

    const inconsistent: DocumentImportAdapter = {
      descriptor: { adapterId: "inconsistent", version: "1.0.0" },
      supports: () => true,
      inspect: () => [{
        ...draft,
        disposition: "ready_for_approval",
        confidence: "high",
      }],
    };
    await expect(createDocumentMigrationDryRun({
      repositoryRoot: root,
      roots: ["README.md"],
      adapters: [inconsistent],
      generatedAt: "2026-08-19T00:00:00Z",
    })).rejects.toMatchObject({ code: "invalid_adapter_contract" });
  });
});
