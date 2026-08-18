import {
  access,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { DocumentManifest, DocumentRegistry } from "@roven/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyInitPlan,
  createInitPlan,
  loadDocumentManifests,
  loadDocumentRegistry,
  serializeYaml,
} from "../src/index.js";
import { managedManifest, userManifest } from "./document-fixture.js";

const roots: string[] = [];

async function initializedRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "roven-documents-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_documents_01" }));
  return root;
}

async function writeManifest(root: string, manifest: DocumentManifest): Promise<void> {
  await writeFile(
    resolve(root, ".roven/documents", `${manifest.documentId}.yaml`),
    serializeYaml(manifest),
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("sharded document storage", () => {
  it("initializes an empty manifest directory without a growing registry file", async () => {
    const root = await initializedRepository();

    expect((await lstat(resolve(root, ".roven/documents"))).isDirectory()).toBe(true);
    await expect(access(resolve(root, ".roven/documents.yaml"))).rejects.toThrow();
    await expect(loadDocumentManifests(root)).resolves.toEqual([]);
    await expect(loadDocumentRegistry(root)).resolves.toEqual({
      schemaVersion: 1,
      documents: {},
    });

    const next = await createInitPlan({ root });
    expect(next.operations).toContainEqual({
      kind: "directory",
      path: ".roven/documents",
      action: "unchanged",
    });
  });

  it("loads independent manifests into the existing in-memory registry contract", async () => {
    const root = await initializedRepository();
    const architecture = userManifest({
      documentId: "doc_architecture_01",
      path: "docs/architecture/context.md",
      relatedDocumentIds: ["doc_skill_guide_01"],
    });
    const skill = userManifest({
      documentId: "doc_skill_guide_01",
      path: "docs/guides/skills.md",
      relatedDocumentIds: ["doc_architecture_01"],
    });
    await writeManifest(root, skill);
    await writeManifest(root, architecture);

    const manifests = await loadDocumentManifests(root);
    expect(manifests.map((manifest) => manifest.documentId)).toEqual([
      "doc_architecture_01",
      "doc_skill_guide_01",
    ]);
    const registry = await loadDocumentRegistry(root);
    expect(Object.keys(registry.documents)).toEqual([
      "doc_architecture_01",
      "doc_skill_guide_01",
    ]);
    expect(registry.documents.doc_architecture_01?.path)
      .toBe("docs/architecture/context.md");
  });

  it("accepts only the standard bounded managed block contract", async () => {
    const root = await initializedRepository();
    const managed = managedManifest();
    await writeManifest(root, managed);

    await expect(loadDocumentManifests(root)).resolves.toEqual([managed]);
  });

  it("rejects a migration transaction marker instead of loading a partial layout", async () => {
    const root = await initializedRepository();
    await writeFile(
      resolve(root, ".roven/documents/.migration-migp_aaaaaaaaaaaaaaaa.lock"),
      "transaction in progress\n",
    );

    await expect(loadDocumentManifests(root)).rejects.toMatchObject({
      code: "document_layout_conflict",
    });
    await expect(loadDocumentRegistry(root)).rejects.toMatchObject({
      code: "document_layout_conflict",
    });
  });

  it("rejects noncanonical paths and oversized sidecars before aggregation", async () => {
    const root = await initializedRepository();
    const path = resolve(root, ".roven/documents/doc_path_0000001.yaml");
    const noncanonical = userManifest({
      documentId: "doc_path_0000001",
      path: "docs//README.md",
    });
    await writeFile(path, serializeYaml(noncanonical));
    await expect(loadDocumentRegistry(root)).rejects.toMatchObject({ code: "contract_invalid" });

    await writeFile(path, "x".repeat(64 * 1024 + 1));
    await expect(loadDocumentRegistry(root)).rejects.toMatchObject({
      code: "document_layout_conflict",
    });
  });

  it("keeps a valid legacy registry byte-identical without creating the new directory", async () => {
    const root = await initializedRepository();
    await rm(resolve(root, ".roven/documents"), { recursive: true });
    const legacy: DocumentRegistry = {
      schemaVersion: 1,
      documents: {
        doc_legacy_0001: userManifest({
          documentId: "doc_legacy_0001",
          path: "README.md",
        }).record,
      },
    };
    const original = `# 기존 형식은 자동 변환하지 않습니다.\n${serializeYaml(legacy)}`;
    await writeFile(resolve(root, ".roven/documents.yaml"), original);

    await expect(loadDocumentRegistry(root)).resolves.toEqual(legacy);
    await expect(loadDocumentManifests(root)).rejects.toMatchObject({
      code: "document_layout_conflict",
    });
    const plan = await createInitPlan({ root });
    expect(plan.status).toBe("ready");
    await applyInitPlan(plan);
    expect(await readFile(resolve(root, ".roven/documents.yaml"), "utf8")).toBe(original);
    await expect(access(resolve(root, ".roven/documents"))).rejects.toThrow();
  });

  it("rejects ambiguous layouts, unsafe entries, duplicate targets, and nonstandard markers", async () => {
    const root = await initializedRepository();
    const legacyBytes = "schemaVersion: 1\ndocuments: {}\n";
    await writeFile(resolve(root, ".roven/documents.yaml"), legacyBytes);
    await expect(loadDocumentRegistry(root)).rejects.toMatchObject({
      code: "document_layout_conflict",
    });
    const ambiguousPlan = await createInitPlan({ root });
    expect(ambiguousPlan.status).toBe("blocked");
    await expect(applyInitPlan(ambiguousPlan)).rejects.toMatchObject({ code: "init_conflict" });
    expect(await readFile(resolve(root, ".roven/documents.yaml"), "utf8")).toBe(legacyBytes);

    await rm(resolve(root, ".roven/documents.yaml"));
    const first = userManifest({ documentId: "doc_duplicate_01", path: "README.md" });
    const second = userManifest({ documentId: "doc_duplicate_02", path: "README.md" });
    await writeManifest(root, first);
    await writeManifest(root, second);
    await expect(loadDocumentRegistry(root)).rejects.toMatchObject({ code: "contract_invalid" });

    await rm(resolve(root, ".roven/documents"), { recursive: true });
    await applyInitPlan(await createInitPlan({ root }));
    const outside = resolve(root, "outside.yaml");
    await writeFile(outside, serializeYaml(first));
    await symlink(outside, resolve(root, ".roven/documents/doc_duplicate_01.yaml"));
    await expect(loadDocumentRegistry(root)).rejects.toMatchObject({
      code: "document_layout_conflict",
    });

    await rm(resolve(root, ".roven/documents/doc_duplicate_01.yaml"));
    await writeManifest(root, managedManifest(false));
    await expect(loadDocumentRegistry(root)).rejects.toMatchObject({ code: "contract_invalid" });
  });
});
