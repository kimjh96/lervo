import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDocumentNormalizationPlan,
  compileConfiguredDocumentNormalizationCandidate,
  createDocumentNormalizationPlan,
  loadDocumentNormalizationCandidate,
  sha256,
  stableId,
  type DocumentNormalizationEnvelope,
  type DocumentNormalizationResponse,
  type RepositoryDocumentNormalizationCompiler,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-document-normalization-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_document_normalization", now: new Date("2026-08-24T00:00:00.000Z") }));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function compiler(calls: DocumentNormalizationEnvelope[]): RepositoryDocumentNormalizationCompiler {
  return {
    descriptor: {
      compilerId: "lervo.fixture.document-normalizer",
      compilerVersion: "1",
      compilerBuildId: sha256("document-normalizer-fixture"),
      provider: "codex",
      isolation: "external_no_capabilities",
    },
    async normalize(envelope): Promise<DocumentNormalizationResponse> {
      calls.push(envelope);
      return {
        schemaVersion: 1,
        documents: envelope.documents.map((document) => {
          const units = document.sourceUnits.map((unit) => unit.index);
          if (document.profile === "portable_skill") return {
            sourcePath: document.path,
            outputs: [{
              path: document.path,
              content: "---\nname: deploy-check\ndescription: Check a deployment without changing it.\n---\n# Deployment check\n\n## Workflow\n\n1. Inspect the deployment.\n2. Report evidence.\n",
              coveredUnitIndexes: units,
            }],
          };
          return {
            sourcePath: document.path,
            outputs: [
              { path: document.path, content: "# Runtime guide\n\nUse the focused topics below.\n\n- [Start](runtime-guide/start.md)\n", coveredUnitIndexes: [units[0]!] },
              { path: "docs/operations/runtime-guide/start.md", content: "# Start the runtime\n\nRun `pnpm start` and verify readiness.\n", coveredUnitIndexes: units },
            ],
          };
        }),
        telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
      };
    },
  };
}

describe("document content normalization", () => {
  it("rewrites and splits documents with exact approvals, records lifecycle, and skips current outputs", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await mkdir(resolve(root, ".agents/skills/deploy-check"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/runtime-guide.md"), "# Runtime notes\n\n## Start\n\nRun `pnpm start`.\n\n## Check\n\nVerify readiness.\n");
    await writeFile(resolve(root, ".agents/skills/deploy-check/SKILL.md"), "---\nname: deploy-check\ndescription: Old deployment checker.\n---\n# Old skill\n\nInspect deployment status.\n");
    const calls: DocumentNormalizationEnvelope[] = [];
    const normalizer = compiler(calls);

    const candidate = await compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: normalizer, signal: new AbortController().signal });
    expect(candidate).toMatchObject({ coverage: { eligibleDocuments: 2, normalizedDocuments: 2, complete: true }, assurance: "unreviewed" });
    expect(calls).toHaveLength(1);
    calls.length = 0;
    const progress: string[] = [];
    const resumed = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
      onShardProgress: ({ status }) => progress.push(status),
    });
    expect(resumed.candidateId).toBe(candidate.candidateId);
    expect(calls).toHaveLength(0);
    expect(progress).toEqual(["started", "cache_hit"]);
    const plan = await createDocumentNormalizationPlan({ repositoryRoot: root, candidate, now: new Date("2026-08-24T01:00:00.000Z") });
    expect(plan.status).toBe("review_required");
    await expect(applyDocumentNormalizationPlan({ plan, candidate, approvals: [], now: new Date("2026-08-24T01:00:00.000Z"), recordApplied: () => undefined })).rejects.toMatchObject({ code: "knowledge_approval_required" });

    const receipt = await applyDocumentNormalizationPlan({
      plan,
      candidate,
      approvals: plan.items.map((item) => ({ operationId: item.operationId, approvalHash: item.approvalHash })),
      now: new Date("2026-08-24T01:00:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(receipt).toMatchObject({ operation: "normalize_documents", normalizedDocumentCount: 2, outputDocumentCount: 3 });
    expect(await readFile(resolve(root, "docs/operations/runtime-guide.md"), "utf8")).toContain("Use the focused topics below");
    expect(await readFile(resolve(root, "docs/operations/runtime-guide/start.md"), "utf8")).toContain("pnpm start");
    expect(await readFile(resolve(root, ".agents/skills/deploy-check/SKILL.md"), "utf8")).toContain("name: deploy-check");
    await expect(access(resolve(root, ".lervo/knowledge/document-normalizations"))).resolves.toBeUndefined();

    calls.length = 0;
    const current = await compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: normalizer, signal: new AbortController().signal });
    expect(current.items).toEqual([]);
    expect(current.coverage.eligibleDocuments).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("rejects a skill rewrite that changes the portable skill identity", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".agents/skills/deploy-check"), { recursive: true });
    await writeFile(resolve(root, ".agents/skills/deploy-check/SKILL.md"), "---\nname: deploy-check\ndescription: Check deployment.\n---\n# Check\n\nInspect status.\n");
    const invalid = compiler([]);
    invalid.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({ sourcePath: document.path, outputs: [{ path: document.path, content: "---\nname: renamed-skill\ndescription: Changed.\n---\n# Changed\n", coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index) }] })),
      telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
    });

    await expect(compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: invalid, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("rejects trailing whitespace introduced by a document normalizer", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/runtime-guide.md"), "# Runtime notes\n\nKeep the runtime current.\n");
    const invalid = compiler([]);
    invalid.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [{
          path: document.path,
          content: "# Runtime guide\n\nStatus: `active`  \n",
          coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
        }],
      })),
      telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
    });

    await expect(compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: invalid, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("rejects a trailing blank line introduced by a document normalizer", async () => {
    const root = await repository();
    await writeFile(resolve(root, "README.md"), "# Project\n\nStart here.\n");
    const invalid = compiler([]);
    invalid.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [{
          path: document.path,
          content: "# Project\n\nStart here.\n\n",
          coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
        }],
      })),
      telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
    });

    await expect(compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: invalid, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("preserves repository lifecycle metadata byte-for-byte", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/roadmap"), { recursive: true });
    await writeFile(resolve(root, "docs/roadmap/v0.md"), "# Roadmap\n\nStatus: `complete`\nAs of: 2026-08-24\n\n## Scope\n\nDone.\n");
    const invalid = compiler([]);
    invalid.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [{
          path: document.path,
          content: "# Roadmap\n\n- Status: `complete`\n- As of: 2026-08-24\n\n## Scope\n\nDone.\n",
          coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
        }],
      })),
      telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
    });

    await expect(compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: invalid, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("uses the portable skill package directory as identity when legacy SKILL.md has no frontmatter", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".agents/skills/deploy-check"), { recursive: true });
    await writeFile(resolve(root, ".agents/skills/deploy-check/SKILL.md"), "# Legacy check\n\nInspect deployment status.\n");
    const calls: DocumentNormalizationEnvelope[] = [];
    const normalizer = compiler(calls);

    const candidate = await compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: normalizer, signal: new AbortController().signal });

    expect(calls[0]?.documents[0]).toMatchObject({ profile: "portable_skill", requiredSkillName: "deploy-check" });
    expect(candidate.items[0]?.outputs[0]?.content).toContain("name: deploy-check");
  });

  it("requires root README agent routing and rewrites non-portable wiki links", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/instructions"), { recursive: true });
    await writeFile(resolve(root, "README.md"), "# Project\n\nUse CLAUDE.md for development.\n");
    await writeFile(resolve(root, "AGENTS.md"), "# Agent instructions\n\nPreserve user work.\n");
    await writeFile(resolve(root, "docs/instructions/voice.md"), "# Voice\n\nFollow [[visual-language]].\n");
    const observed: DocumentNormalizationEnvelope[] = [];
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        observed.push(envelope);
        return {
          schemaVersion: 1,
          documents: envelope.documents.map((document) => ({
            sourcePath: document.path,
            outputs: [{
              path: document.path,
              content: document.path === "README.md"
                ? "# Project\n\nRead AGENTS.md before development.\n"
                : document.path.endsWith("voice.md")
                  ? "# Voice\n\nFollow [[visual-language]].\n"
                  : "# Agent instructions\n\nPreserve user work.\n",
              coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
            }],
          })),
          telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
        };
      },
    };

    await expect(compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: normalizer, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "knowledge_compile_failed" });
    expect(observed.flatMap((envelope) => envelope.documents).find((document) => document.path === "README.md")?.constraints)
      .toMatchObject({
        requiredAgentInstructionPath: "AGENTS.md",
        allowSiblingTopicSplit: false,
        allowedSplitPrefix: null,
      });
    expect(observed.flatMap((envelope) => envelope.documents).find((document) => document.path.endsWith("voice.md"))?.constraints)
      .toMatchObject({ rewriteWikiLinksAsMarkdown: true });

    normalizer.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [{
          path: document.path,
          content: document.path === "README.md"
            ? "# Project\n\nRead the development guide.\n"
            : document.path.endsWith("voice.md")
              ? "# Voice\n\nFollow [visual language](visual-language.md).\n"
              : "# Agent instructions\n\nPreserve user work.\n",
          coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
        }],
      })),
      telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
    });
    await expect(compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: normalizer, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("keeps lifecycle current across managed-block refreshes and replaces stale records", async () => {
    const root = await repository();
    const frontmatter = "---\ndescription: Repository instructions.\nglobs: \"**/*.ts\"\n---\n\n";
    const beforeBlock = "<!-- lervo:begin block=routes schema=1 -->\n- Read [old](docs/old.md).\n<!-- lervo:end block=routes -->";
    const afterBlock = "<!-- lervo:begin block=routes schema=1 -->\n- Read [new](docs/new.md).\n<!-- lervo:end block=routes -->";
    await writeFile(resolve(root, "AGENTS.md"), `${frontmatter}# Agent instructions\n\nPreserve user work.\n\n${beforeBlock}\n`);
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        return {
          schemaVersion: 1,
          documents: envelope.documents.map((document) => ({ sourcePath: document.path, outputs: [{ path: document.path, content: `${frontmatter}# Agent instructions\n\nPreserve user work.\n\n${document.untrustedSourceData.includes("docs/new.md") ? afterBlock : beforeBlock}\n`, coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index) }] })),
          telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
        };
      },
    };
    const first = await compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: normalizer, signal: new AbortController().signal });
    const firstPlan = await createDocumentNormalizationPlan({ repositoryRoot: root, candidate: first, now: new Date("2026-08-24T02:00:00.000Z") });
    await applyDocumentNormalizationPlan({ plan: firstPlan, candidate: first, approvals: firstPlan.items.map((item) => ({ operationId: item.operationId, approvalHash: item.approvalHash })), now: new Date("2026-08-24T02:00:00.000Z"), recordApplied: () => undefined });

    await writeFile(resolve(root, "AGENTS.md"), `${frontmatter}# Agent instructions\n\nPreserve user work.\n\n${afterBlock}\n`);
    const current = await compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: normalizer, signal: new AbortController().signal });
    expect(current.items).toEqual([]);

    await writeFile(resolve(root, "AGENTS.md"), `${frontmatter}# Agent instructions\n\nPreserve user work and tests.\n\n${afterBlock}\n`);
    const replacement = await compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: normalizer, signal: new AbortController().signal });
    const replacementPlan = await createDocumentNormalizationPlan({ repositoryRoot: root, candidate: replacement, now: new Date("2026-08-24T03:00:00.000Z") });
    expect(replacementPlan.operations.filter((operation) => operation.action === "delete")).toHaveLength(1);
    const receipt = await applyDocumentNormalizationPlan({ plan: replacementPlan, candidate: replacement, approvals: replacementPlan.items.map((item) => ({ operationId: item.operationId, approvalHash: item.approvalHash })), now: new Date("2026-08-24T03:00:00.000Z"), recordApplied: () => undefined });
    expect(receipt.deleted).toHaveLength(1);
  });

  it("rejects an unsafe stored candidate even when its outer candidate ID is rebound", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/runtime-guide.md"), "# Runtime notes\n\n## Start\n\nRun `pnpm start`.\n");
    const candidate = await compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: compiler([]), signal: new AbortController().signal });
    const invalid = structuredClone(candidate);
    invalid.items[0]!.outputs[0]!.path = "../escape.md";
    const { schemaVersion: _schemaVersion, candidateId: _candidateId, ...materials } = invalid;
    invalid.candidateId = stableId("knorm", materials);
    const shard = invalid.candidateId.slice("knorm_".length, "knorm_".length + 2);
    const directory = resolve(root, ".lervo/state/knowledge/normalization-candidates", shard);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${invalid.candidateId}.json`), `${JSON.stringify(invalid)}\n`);

    await expect(loadDocumentNormalizationCandidate({ repositoryRoot: root, candidateId: invalid.candidateId }))
      .rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("runs large normalization sets with bounded shard concurrency", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await Promise.all(Array.from({ length: 25 }, (_, index) => writeFile(
      resolve(root, `docs/operations/guide-${String(index).padStart(2, "0")}.md`),
      `# Guide ${index}\n\nKeep this guide current.\n`,
    )));
    let active = 0;
    let maximumActive = 0;
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        active -= 1;
        return {
          schemaVersion: 1,
          documents: envelope.documents.map((document) => ({
            sourcePath: document.path,
            outputs: [{ path: document.path, content: `# Normalized ${document.path}\n`, coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index) }],
          })),
          telemetry: { filesystemReads: 0, filesystemWrites: 0, shellProcesses: 0, networkRequests: 0, externalActions: 0, toolCalls: 0, complete: true },
        };
      },
    };

    const candidate = await compileConfiguredDocumentNormalizationCandidate({ repositoryRoot: root, compiler: normalizer, signal: new AbortController().signal });

    expect(candidate.items).toHaveLength(25);
    expect(maximumActive).toBe(3);
  });
});
