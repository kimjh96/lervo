import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { applyKnowledgeMigrationPlan, createKnowledgeMigrationPlan, lintRepositoryKnowledge, queryRepositoryKnowledge } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyOkfImportPlan,
  createOkfImportPlan,
  exportRepositoryKnowledgeToOkf,
  lintOkfBundle,
  loadOkfImportCandidate,
  queryOkfBundle,
  readOkfBundle,
  reExportOkfImportCandidate,
} from "../src/index.js";

const roots: string[] = [];
const execFile = promisify(execFileCallback);

async function temporary(name: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), name));
  roots.push(root);
  return root;
}

async function initialized(projectId: string): Promise<string> {
  const root = await temporary("lervo-okf-repository-");
  await applyInitPlan(await createInitPlan({ root, projectId }));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OKF v0.2 exchange", () => {
  it("exports deterministic conformant Markdown without modifying native publications", async () => {
    const root = await initialized("prj_okfexport01");
    const readme = "# Portable knowledge\n\nNative user bytes stay unchanged.\n";
    await writeFile(resolve(root, "README.md"), readme);
    const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root });
    await applyKnowledgeMigrationPlan(migration, new Date("2026-08-22T00:00:00Z"), () => undefined);

    const parent = await temporary("lervo-okf-exports-");
    const first = await exportRepositoryKnowledgeToOkf({ repositoryRoot: root, outputRoot: resolve(parent, "first") });
    const second = await exportRepositoryKnowledgeToOkf({ repositoryRoot: root, outputRoot: resolve(parent, "second") });
    expect(first.bundleDigest).toBe(second.bundleDigest);
    expect(first.conceptCount).toBeGreaterThan(0);
    expect(await readFile(resolve(root, "README.md"), "utf8")).toBe(readme);
    const firstBundle = await readOkfBundle(resolve(parent, "first"));
    const secondBundle = await readOkfBundle(resolve(parent, "second"));
    expect(firstBundle.bundleDigest).toBe(secondBundle.bundleDigest);
    expect(firstBundle.okfVersion).toBe("0.2");
    expect(firstBundle.concepts.every((concept) => typeof concept.frontmatter.type === "string")).toBe(true);
    expect((await lintOkfBundle(resolve(parent, "first"))).valid).toBe(true);
    await expect(exportRepositoryKnowledgeToOkf({ repositoryRoot: root, outputRoot: resolve(parent, "first") }))
      .rejects.toMatchObject({ code: "knowledge_exchange_invalid" });
  });

  it("plans import read-only, preserves unknown metadata and never promotes external verification", async () => {
    const target = await initialized("prj_okfimport01");
    const bundle = await temporary("lervo-okf-source-");
    await writeFile(resolve(bundle, "index.md"), "---\nokf_version: \"0.2\"\n---\n# Bundle\n\n* [Policy](policy.md)\n");
    const concept = [
      "---",
      "type: Policy",
      "title: External policy",
      "status: deprecated",
      "verified: { by: human:external-reviewer, at: 2026-08-20T00:00:00Z }",
      "sources:",
      "  - { id: policy-source, resource: https://example.invalid/policy }",
      "vendor_extension:",
      "  nested: [one, two]",
      "---",
      "This rule came from the source.[^policy-source]",
      "",
      "[^policy-source]: External policy source",
      "",
    ].join("\n");
    await writeFile(resolve(bundle, "policy.md"), concept);

    const first = await createOkfImportPlan({ repositoryRoot: target, bundleRoot: bundle });
    const second = await createOkfImportPlan({ repositoryRoot: target, bundleRoot: bundle });
    expect(first.planId).toBe(second.planId);
    expect(first.status).toBe("ready");
    expect(first.externalHumanVerifiedCount).toBe(1);
    expect(first.unknownMetadataConceptCount).toBe(1);
    await expect(access(resolve(target, first.targetPath))).rejects.toThrow();

    const receipt = await applyOkfImportPlan({ repositoryRoot: target, bundleRoot: bundle, planId: first.planId });
    expect(receipt).toMatchObject({ created: true, localAssurance: "unreviewed" });
    const loaded = await loadOkfImportCandidate({ repositoryRoot: target, candidateId: first.candidateId });
    expect(loaded.concepts[0]).toMatchObject({
      externalTrust: "human_reviewed",
      localAssurance: "unreviewed",
      frontmatter: { status: "deprecated", vendor_extension: { nested: ["one", "two"] } },
      unknownMetadata: { vendor_extension: { nested: ["one", "two"] } },
    });
    expect((await applyOkfImportPlan({ repositoryRoot: target, bundleRoot: bundle, planId: first.planId })).created).toBe(false);

    const outputParent = await temporary("lervo-okf-roundtrip-");
    const reexport = await reExportOkfImportCandidate({ repositoryRoot: target, candidateId: first.candidateId, outputRoot: resolve(outputParent, "bundle") });
    expect(reexport.bundleDigest).toBe(first.bundleDigest);
    expect(await readFile(resolve(outputParent, "bundle/policy.md"), "utf8")).toBe(concept);
  });

  it("fails a stale import plan and keeps lexical query at recommended semantics", async () => {
    const target = await initialized("prj_okfstale001");
    const bundle = await temporary("lervo-okf-stale-source-");
    await writeFile(resolve(bundle, "concept.md"), "---\ntype: Reference\ntitle: Alpha contract\n---\nAlpha source body.\n");
    const plan = await createOkfImportPlan({ repositoryRoot: target, bundleRoot: bundle });
    const query = await queryOkfBundle({ bundleRoot: bundle, query: "alpha" });
    expect(query).toMatchObject({ semantics: "recommended", hits: [{ title: "Alpha contract", localAssurance: "unreviewed" }] });
    await writeFile(resolve(bundle, "concept.md"), "---\ntype: Reference\ntitle: Beta contract\n---\nBeta source body.\n");
    await expect(applyOkfImportPlan({ repositoryRoot: target, bundleRoot: bundle, planId: plan.planId }))
      .rejects.toMatchObject({ code: "knowledge_exchange_invalid" });
  });

  it("rejects a mutated stored candidate instead of re-exporting unbound bytes", async () => {
    const target = await initialized("prj_okftamper01");
    const bundle = await temporary("lervo-okf-tamper-source-");
    await writeFile(resolve(bundle, "concept.md"), "---\ntype: Reference\ncustom: preserved\n---\nOriginal body.\n");
    const plan = await createOkfImportPlan({ repositoryRoot: target, bundleRoot: bundle });
    await applyOkfImportPlan({ repositoryRoot: target, bundleRoot: bundle, planId: plan.planId });
    const path = resolve(target, plan.targetPath);
    const mutated = (await readFile(path, "utf8")).replace("Original body.", "Mutated body.");
    await writeFile(path, mutated);
    await expect(loadOkfImportCandidate({ repositoryRoot: target, candidateId: plan.candidateId }))
      .rejects.toMatchObject({ code: "knowledge_exchange_invalid" });
  });

  it("rejects symlinked bundle content", async () => {
    const bundle = await temporary("lervo-okf-symlink-");
    const outside = resolve(await temporary("lervo-okf-outside-"), "secret.md");
    await writeFile(outside, "---\ntype: Secret\n---\nsecret\n");
    await symlink(outside, resolve(bundle, "linked.md"));
    expect((await lintOkfBundle(bundle)).valid).toBe(false);
  });

  it("reproduces native lint/query and the same export digest after a real Git clone", async () => {
    const source = await initialized("prj_okfgitclone");
    await writeFile(resolve(source, "README.md"), "# Clone knowledge\n\nGit-carried nebula contract.\n");
    const plan = await createKnowledgeMigrationPlan({ repositoryRoot: source });
    await applyKnowledgeMigrationPlan(plan, new Date("2026-08-22T00:00:00Z"), () => undefined);
    await execFile("git", ["init", "-q"], { cwd: source });
    await execFile("git", ["add", "."], { cwd: source });
    await execFile("git", ["-c", "user.name=Lervo Fixture", "-c", "user.email=lervo@example.invalid", "commit", "-qm", "knowledge fixture"], { cwd: source });

    const cloneParent = await temporary("lervo-okf-clone-parent-");
    const clone = resolve(cloneParent, "clone");
    await execFile("git", ["clone", "-q", source, clone]);
    expect(await lintRepositoryKnowledge(clone)).toMatchObject({ valid: true, issues: [] });
    expect((await queryRepositoryKnowledge({ repositoryRoot: clone, query: "nebula" })).hits)
      .toEqual([expect.objectContaining({ path: "README.md", assurance: "unreviewed" })]);

    const exportParent = await temporary("lervo-okf-clone-exports-");
    const sourceExport = await exportRepositoryKnowledgeToOkf({ repositoryRoot: source, outputRoot: resolve(exportParent, "source") });
    const cloneExport = await exportRepositoryKnowledgeToOkf({ repositoryRoot: clone, outputRoot: resolve(exportParent, "clone") });
    expect(cloneExport.bundleDigest).toBe(sourceExport.bundleDigest);
  });
});
