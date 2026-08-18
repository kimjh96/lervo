import { createHash } from "node:crypto";
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
import { dirname, resolve } from "node:path";

import type { DocumentRecord, DocumentRegistry } from "@roven/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { createLegacyRegistryMigrationDryRun } from "../src/index.js";

const roots: string[] = [];

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function record(path: string): DocumentRecord {
  return {
    path,
    kind: "canonical",
    responsibleParty: { kind: "team", id: "maintainers" },
    connectedPaths: ["src"],
    verifiedRevision: "git:legacy",
    verifiedAt: "2026-08-19T00:00:00Z",
    reviewIntervalDays: 30,
    ownership: { mode: "user" },
  };
}

async function fixtureRoot(registry: DocumentRegistry): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "roven-legacy-registry-plan-"));
  roots.push(root);
  await mkdir(resolve(root, ".roven"));
  await writeFile(
    resolve(root, ".roven/documents.yaml"),
    `${JSON.stringify(registry, null, 2)}\n`,
  );
  return root;
}

async function treeSnapshot(root: string, current = root): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
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

describe("legacy document registry structural migration dry-run", () => {
  it("binds split entry artifacts, referenced documents, and an archive target without writes", async () => {
    const root = await fixtureRoot({
      schemaVersion: 1,
      documents: {
        doc_guide_0000001: record("docs/guide.md"),
        doc_readme_000001: record("README.md"),
      },
    });
    await mkdir(resolve(root, "docs"));
    await writeFile(resolve(root, "README.md"), "# Existing README\n");
    const before = await treeSnapshot(root);

    const result = await createLegacyRegistryMigrationDryRun({
      repositoryRoot: root,
      generatedAt: "2026-08-19T03:00:00Z",
    });

    expect(result.plan).toMatchObject({
      mode: "legacy_registry_structural_dry_run",
      writesAllowed: false,
      approvalStatus: "not_requested",
      outcome: "review_required",
      source: {
        path: ".roven/documents.yaml",
        deactivationAction: "archive_then_remove",
      },
      manifestDirectory: {
        path: ".roven/documents",
        expected: { kind: "missing" },
      },
      warnings: expect.arrayContaining([
        "legacy_content_policy_requires_review",
        "referenced_document_missing",
      ]),
    });
    expect(result.plan.archiveTarget.path).toBe(
      `.roven/archive/document-registries/sha256/${
        result.plan.source.contentHash.slice("sha256:".length)
      }.yaml`,
    );
    expect(result.plan.entries.map((entry) => entry.documentId)).toEqual([
      "doc_guide_0000001",
      "doc_readme_000001",
    ]);
    expect(result.plan.referencedDocuments).toEqual([
      {
        documentId: "doc_guide_0000001",
        path: "docs/guide.md",
        snapshot: { kind: "missing" },
      },
      {
        documentId: "doc_readme_000001",
        path: "README.md",
        snapshot: {
          kind: "file",
          contentHash: hash(Buffer.from("# Existing README\n")),
          byteCount: Buffer.byteLength("# Existing README\n"),
        },
      },
    ]);
    expect(result.entryArtifacts).toHaveLength(2);
    for (const artifact of result.entryArtifacts) {
      const bytes = result.entryArtifactBytes.get(artifact.artifactId);
      expect(bytes).toBeDefined();
      expect(hash(bytes as Uint8Array)).toBe(artifact.contentHash);
      expect(bytes?.byteLength).toBe(artifact.byteCount);
      expect(artifact.sourceRegistryHash).toBe(result.plan.source.contentHash);
      expect(result.plan.entries.find((entry) => entry.documentId === artifact.documentId))
        .toMatchObject({
          artifactId: artifact.artifactId,
          artifactHash: artifact.contentHash,
        });
    }
    expect(await treeSnapshot(root)).toEqual(before);
    await expect(access(resolve(root, ".roven/archive"))).rejects.toThrow();
    await expect(access(resolve(root, ".roven/documents"))).rejects.toThrow();
  });

  it("is deterministic across generation times and changes every bound coordinate with source bytes", async () => {
    const root = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_readme_000001: record("README.md") },
    });
    await writeFile(resolve(root, "README.md"), "# README\n");
    const first = await createLegacyRegistryMigrationDryRun({
      repositoryRoot: root,
      generatedAt: "2026-08-19T03:00:00Z",
    });
    const second = await createLegacyRegistryMigrationDryRun({
      repositoryRoot: root,
      generatedAt: "2026-08-19T04:00:00Z",
    });
    expect(second.plan.planId).toBe(first.plan.planId);
    expect(second.plan.archiveTarget.path).toBe(first.plan.archiveTarget.path);
    expect(second.entryArtifacts).toEqual(first.entryArtifacts);

    const parsed = JSON.parse(
      await readFile(resolve(root, ".roven/documents.yaml"), "utf8"),
    ) as DocumentRegistry;
    await writeFile(resolve(root, ".roven/documents.yaml"), `${JSON.stringify(parsed)}\n`);
    const changed = await createLegacyRegistryMigrationDryRun({
      repositoryRoot: root,
      generatedAt: "2026-08-19T05:00:00Z",
    });
    expect(changed.plan.planId).not.toBe(first.plan.planId);
    expect(changed.plan.source.contentHash).not.toBe(first.plan.source.contentHash);
    expect(changed.plan.archiveTarget.path).not.toBe(first.plan.archiveTarget.path);
    expect(changed.entryArtifacts[0]?.contentHash)
      .not.toBe(first.entryArtifacts[0]?.contentHash);
  });

  it("reports active-layout, archive, and duplicate ownership conflicts without changing them", async () => {
    const root = await fixtureRoot({
      schemaVersion: 1,
      documents: {
        doc_first_0000001: record("README.md"),
        doc_second_000001: record("README.md"),
      },
    });
    const initial = await createLegacyRegistryMigrationDryRun({
      repositoryRoot: root,
      generatedAt: "2026-08-19T03:00:00Z",
    });
    await mkdir(resolve(root, ".roven/documents"));
    await writeFile(
      resolve(root, ".roven/documents/doc_first_0000001.yaml"),
      "occupied sidecar target\n",
    );
    await mkdir(dirname(resolve(root, initial.plan.archiveTarget.path)), { recursive: true });
    await writeFile(resolve(root, initial.plan.archiveTarget.path), "conflicting archive bytes\n");
    const before = await treeSnapshot(root);

    const conflicted = await createLegacyRegistryMigrationDryRun({
      repositoryRoot: root,
      generatedAt: "2026-08-19T03:00:00Z",
    });
    expect(conflicted.plan.outcome).toBe("conflict");
    expect(conflicted.plan.warnings).toEqual(expect.arrayContaining([
      "archive_target_conflict",
      "duplicate_legacy_document_path",
      "legacy_and_sharded_layout_conflict",
      "sidecar_target_conflict",
    ]));
    expect(await treeSnapshot(root)).toEqual(before);
  });

  it("rejects invalid or linked legacy registries instead of treating them as migrated", async () => {
    const invalidRoot = await fixtureRoot({ schemaVersion: 1, documents: {} });
    await writeFile(resolve(invalidRoot, ".roven/documents.yaml"), "not: a registry\n");
    await expect(createLegacyRegistryMigrationDryRun({
      repositoryRoot: invalidRoot,
      generatedAt: "2026-08-19T03:00:00Z",
    })).rejects.toMatchObject({ code: "invalid_legacy_registry" });

    const unsafeReferenceRoot = await fixtureRoot({
      schemaVersion: 1,
      documents: { doc_linked_0000001: record("linked.md") },
    });
    await writeFile(resolve(unsafeReferenceRoot, "outside.md"), "# Outside\n");
    await symlink(
      resolve(unsafeReferenceRoot, "outside.md"),
      resolve(unsafeReferenceRoot, "linked.md"),
    );
    const unsafeReference = await createLegacyRegistryMigrationDryRun({
      repositoryRoot: unsafeReferenceRoot,
      generatedAt: "2026-08-19T03:00:00Z",
    });
    expect(unsafeReference.plan).toMatchObject({
      outcome: "conflict",
      warnings: expect.arrayContaining(["referenced_document_unsafe"]),
    });

    const linkedRoot = await mkdtemp(resolve(tmpdir(), "roven-legacy-registry-link-"));
    roots.push(linkedRoot);
    await mkdir(resolve(linkedRoot, ".roven"));
    await writeFile(resolve(linkedRoot, "outside.yaml"), "schemaVersion: 1\ndocuments: {}\n");
    await symlink(
      resolve(linkedRoot, "outside.yaml"),
      resolve(linkedRoot, ".roven/documents.yaml"),
    );
    await expect(createLegacyRegistryMigrationDryRun({
      repositoryRoot: linkedRoot,
      generatedAt: "2026-08-19T03:00:00Z",
    })).rejects.toMatchObject({ code: "unsafe_source" });
  });
});
