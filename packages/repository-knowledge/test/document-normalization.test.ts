import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDocumentNormalizationPlan,
  compileConfiguredDocumentNormalizationCandidate,
  createConfiguredDocumentNormalizationPreflight,
  createDocumentNormalizationPlan,
  inspectConfiguredDocumentNormalization,
  lintRepositoryKnowledge,
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
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_document_normalization",
      now: new Date("2026-08-24T00:00:00.000Z"),
    }),
  );
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
          if (document.profile === "portable_skill")
            return {
              sourcePath: document.path,
              outputs: [
                {
                  path: document.path,
                  content:
                    "---\nname: deploy-check\ndescription: Check a deployment without changing it.\n---\n# Deployment check\n\n## Workflow\n\n1. Inspect the deployment.\n2. Report evidence.\n",
                  coveredUnitIndexes: units,
                },
              ],
            };
          return {
            sourcePath: document.path,
            outputs: [
              {
                path: document.path,
                content:
                  "# Runtime guide\n\nUse the focused topics below.\n\n- [Start](runtime-guide/start.md)\n",
                coveredUnitIndexes: [units[0]!],
              },
              {
                path: "docs/operations/runtime-guide/start.md",
                content: "# Start the runtime\n\nRun `pnpm start` and verify readiness.\n",
                coveredUnitIndexes: units,
              },
            ],
          };
        }),
        telemetry: {
          filesystemReads: 0,
          filesystemWrites: 0,
          shellProcesses: 0,
          networkRequests: 0,
          externalActions: 0,
          toolCalls: 0,
          complete: true,
        },
      };
    },
  };
}

function normalizedResponse(
  envelope: DocumentNormalizationEnvelope,
): DocumentNormalizationResponse {
  return {
    schemaVersion: 1,
    documents: envelope.documents.map((document) => ({
      sourcePath: document.path,
      outputs: [
        {
          path: document.path,
          content: `# Normalized guide\n\nKeep ${document.path} current.\n`,
          coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
        },
      ],
    })),
    telemetry: {
      filesystemReads: 0,
      filesystemWrites: 0,
      shellProcesses: 0,
      networkRequests: 0,
      externalActions: 0,
      toolCalls: 0,
      complete: true,
    },
  };
}

describe("document content normalization", () => {
  it("preflights and compiles only stale reviewed documents without hiding new pending work", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/reviewed.md"), "# Reviewed\n\nOriginal.\n");
    const initialCalls: DocumentNormalizationEnvelope[] = [];
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        initialCalls.push(envelope);
        return normalizedResponse(envelope);
      },
    };
    const initial = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    const initialPlan = await createDocumentNormalizationPlan({
      repositoryRoot: root,
      candidate: initial,
      now: new Date("2026-09-04T00:00:00.000Z"),
    });
    await applyDocumentNormalizationPlan({
      plan: initialPlan,
      candidate: initial,
      approvals: initialPlan.items.map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
      now: new Date("2026-09-04T00:00:00.000Z"),
      recordApplied: () => undefined,
    });
    await writeFile(resolve(root, "docs/operations/reviewed.md"), "# Reviewed\n\nChanged.\n");
    await writeFile(resolve(root, "docs/operations/new.md"), "# New\n\nUnreviewed.\n");
    const calls: DocumentNormalizationEnvelope[] = [];
    const replacementNormalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: normalizer.descriptor,
      async normalize(envelope) {
        calls.push(envelope);
        return normalizedResponse(envelope);
      },
    };

    const preflight = await createConfiguredDocumentNormalizationPreflight({
      repositoryRoot: root,
      compiler: replacementNormalizer,
      scope: "stale",
    });

    expect(calls).toEqual([]);
    expect(preflight).toMatchObject({
      status: "ready",
      workset: {
        scope: "stale",
        repository: {
          pendingDocuments: 2,
          staleDocuments: 1,
          unrecordedDocuments: 1,
        },
        selectedDocuments: 1,
      },
      selection: { envelopeCount: 1, cacheHits: 0, cacheMisses: 1 },
    });
    expect(preflight.selection.documents.map((document) => document.path)).toEqual([
      "docs/operations/reviewed.md",
    ]);

    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: replacementNormalizer,
      signal: new AbortController().signal,
      scope: "stale",
    });
    expect(candidate.workset).toEqual(preflight.workset);
    expect(candidate.items.map((item) => item.sourcePath)).toEqual(["docs/operations/reviewed.md"]);
    const cachedPreflight = await createConfiguredDocumentNormalizationPreflight({
      repositoryRoot: root,
      compiler: replacementNormalizer,
      scope: "stale",
    });
    expect(cachedPreflight.selection).toMatchObject({ cacheHits: 1, cacheMisses: 0 });
    const plan = await createDocumentNormalizationPlan({
      repositoryRoot: root,
      candidate,
      now: new Date("2026-09-04T01:00:00.000Z"),
    });
    expect(plan.status).toBe("review_required");
    await applyDocumentNormalizationPlan({
      plan,
      candidate,
      approvals: plan.items.map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
      now: new Date("2026-09-04T01:00:00.000Z"),
      recordApplied: () => undefined,
    });
    const lifecycle = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
    expect(lifecycle.pendingDocuments).toEqual(["docs/operations/new.md"]);
  });

  it("binds an explicit path subset inside the selected lifecycle scope", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/alpha.md"), "# Alpha\n\nOriginal.\n");
    await writeFile(resolve(root, "docs/operations/beta.md"), "# Beta\n\nOriginal.\n");
    const initialCompiler: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      normalize: async (envelope) => normalizedResponse(envelope),
    };
    const initial = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: initialCompiler,
      signal: new AbortController().signal,
    });
    const initialPlan = await createDocumentNormalizationPlan({
      repositoryRoot: root,
      candidate: initial,
      now: new Date("2026-09-04T00:00:00.000Z"),
    });
    await applyDocumentNormalizationPlan({
      plan: initialPlan,
      candidate: initial,
      approvals: initialPlan.items.map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
      now: new Date("2026-09-04T00:00:00.000Z"),
      recordApplied: () => undefined,
    });
    await writeFile(resolve(root, "docs/operations/alpha.md"), "# Alpha\n\nChanged.\n");
    await writeFile(resolve(root, "docs/operations/beta.md"), "# Beta\n\nChanged.\n");
    await writeFile(resolve(root, "docs/operations/new.md"), "# New\n\nUnreviewed.\n");
    const calls: DocumentNormalizationEnvelope[] = [];
    const replacementCompiler: RepositoryDocumentNormalizationCompiler = {
      descriptor: initialCompiler.descriptor,
      async normalize(envelope) {
        calls.push(envelope);
        return normalizedResponse(envelope);
      },
    };
    const sourcePaths = ["docs/operations/beta.md"];

    const preflight = await createConfiguredDocumentNormalizationPreflight({
      repositoryRoot: root,
      compiler: replacementCompiler,
      scope: "stale",
      sourcePaths,
    });

    expect(preflight).toMatchObject({
      status: "ready",
      workset: {
        scope: "stale",
        selection: { kind: "explicit_paths" },
        repository: { pendingDocuments: 3, staleDocuments: 2, unrecordedDocuments: 1 },
        selectedDocuments: 1,
      },
    });
    expect(preflight.selection.documents.map((document) => document.path)).toEqual(sourcePaths);
    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: replacementCompiler,
      signal: new AbortController().signal,
      scope: "stale",
      sourcePaths,
    });
    expect(candidate.workset).toEqual(preflight.workset);
    const plan = await createDocumentNormalizationPlan({
      repositoryRoot: root,
      candidate,
      now: new Date("2026-09-04T01:00:00.000Z"),
    });
    expect(plan.status).toBe("review_required");
    const receipt = await applyDocumentNormalizationPlan({
      plan,
      candidate,
      approvals: plan.items.map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
      now: new Date("2026-09-04T01:00:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(receipt.workset.selection).toEqual({ kind: "explicit_paths" });
    expect(JSON.stringify(receipt.workset)).not.toContain("docs/operations/beta.md");
    expect(
      (await inspectConfiguredDocumentNormalization({ repositoryRoot: root })).pendingDocuments,
    ).toEqual(["docs/operations/alpha.md", "docs/operations/new.md"]);
  });

  it("rejects explicit paths outside the lifecycle scope before provider work", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/new.md"), "# New\n\nUnreviewed.\n");
    const calls: DocumentNormalizationEnvelope[] = [];

    await expect(
      createConfiguredDocumentNormalizationPreflight({
        repositoryRoot: root,
        compiler: compiler(calls),
        scope: "stale",
        sourcePaths: ["docs/operations/new.md"],
      }),
    ).rejects.toMatchObject({ code: "normalization_selection_invalid" });
    expect(calls).toEqual([]);
  });

  it("blocks provider generation before a declared workset ceiling is exceeded", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/bounded.md"), "# Bounded\n\nContent.\n");
    const calls: DocumentNormalizationEnvelope[] = [];
    const normalizer = compiler(calls);
    const preflight = await createConfiguredDocumentNormalizationPreflight({
      repositoryRoot: root,
      compiler: normalizer,
      ceilings: { maximumSourceBytes: 1 },
    });
    expect(preflight.status).toBe("blocked");
    expect(preflight.blockers).toEqual([
      expect.objectContaining({ code: "source_bytes_exceeded", limit: 1 }),
    ]);
    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: normalizer,
        signal: new AbortController().signal,
        ceilings: { maximumSourceBytes: 1 },
      }),
    ).rejects.toMatchObject({ code: "normalization_budget_exceeded" });
    expect(calls).toEqual([]);
  });

  it("reserves bounded batch-fallback capacity before provider generation", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/alpha.md"), "# Alpha\n\nContent.\n");
    await writeFile(resolve(root, "docs/operations/beta.md"), "# Beta\n\nContent.\n");
    const calls: DocumentNormalizationEnvelope[] = [];
    const normalizer = compiler(calls);
    const preflight = await createConfiguredDocumentNormalizationPreflight({
      repositoryRoot: root,
      compiler: normalizer,
      ceilings: { maximumProviderCalls: 2 },
    });
    expect(preflight).toMatchObject({
      status: "blocked",
      selection: { envelopeCount: 1, cacheMisses: 2, providerCallCapacity: 3 },
      blockers: [{ code: "provider_calls_exceeded", observed: 3, limit: 2 }],
    });
    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: normalizer,
        signal: new AbortController().signal,
        ceilings: { maximumProviderCalls: 2 },
      }),
    ).rejects.toMatchObject({ code: "normalization_budget_exceeded" });
    expect(calls).toEqual([]);
  });

  it("keeps invalid lifecycle records out of the stale scope", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/pending.md"), "# Pending\n\nContent.\n");
    const recordId = "knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa";
    await mkdir(resolve(root, ".lervo/knowledge/document-normalizations/aa"), {
      recursive: true,
    });
    await writeFile(
      resolve(root, `.lervo/knowledge/document-normalizations/aa/${recordId}.yaml`),
      `schemaVersion: 1\nrecordId: ${recordId}\nsourcePath: docs/operations/pending.md\noutputs: []\n`,
    );
    const calls: DocumentNormalizationEnvelope[] = [];
    const normalizer = compiler(calls);
    const stale = await createConfiguredDocumentNormalizationPreflight({
      repositoryRoot: root,
      compiler: normalizer,
      scope: "stale",
    });
    const allPending = await createConfiguredDocumentNormalizationPreflight({
      repositoryRoot: root,
      compiler: normalizer,
      scope: "all_pending",
    });
    expect(stale).toMatchObject({
      status: "current",
      workset: {
        repository: { pendingDocuments: 1, staleDocuments: 0, unrecordedDocuments: 1 },
        selectedDocuments: 0,
      },
    });
    expect(allPending.workset.selectedDocuments).toBe(1);
    expect(calls).toEqual([]);
  });

  it("keeps dependency environments and preservation collections outside normalization", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".venv/licenses"), { recursive: true });
    await mkdir(resolve(root, "docs/archive"), { recursive: true });
    await mkdir(resolve(root, "docs/inherited/legacy"), { recursive: true });
    await writeFile(resolve(root, ".venv/licenses/dependency.md"), "# Dependency license\n");
    await writeFile(resolve(root, "docs/archive/status.md"), "# Archived status\n");
    await writeFile(resolve(root, "docs/inherited/legacy/finding.md"), "# Inherited finding\n");
    const calls: DocumentNormalizationEnvelope[] = [];

    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: compiler(calls),
      signal: new AbortController().signal,
    });

    expect(candidate.coverage).toEqual({
      eligibleDocuments: 0,
      normalizedDocuments: 0,
      sourceUnits: 0,
      complete: true,
    });
    expect(calls).toHaveLength(0);
  });

  it("honors tracked normalization-only exclusions without removing sources from scanning", async () => {
    const root = await repository();
    const policyPath = resolve(root, ".lervo/knowledge/policy.yaml");
    await writeFile(
      policyPath,
      (await readFile(policyPath, "utf8")).replace(
        "normalization:\n  exclude: []",
        "normalization:\n  exclude:\n    - docs/knowledge/**",
      ),
    );
    await mkdir(resolve(root, "docs/knowledge"), { recursive: true });
    await writeFile(resolve(root, "docs/knowledge/decision.md"), "# Existing decision\n");
    const calls: DocumentNormalizationEnvelope[] = [];

    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: compiler(calls),
      signal: new AbortController().signal,
    });

    expect(candidate.sourceSnapshotId).toMatch(/^ksnap_/u);
    expect(candidate.coverage.eligibleDocuments).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("keeps the bounded release-intent workspace outside provider normalization", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".changes"), { recursive: true });
    await writeFile(
      resolve(root, ".changes/current-release.md"),
      '<!-- lervo-release package="@lervo/cli" version="0.2.0" schema="1" -->\n\n## What\'s changed\n\n- Release.\n',
    );
    const calls: DocumentNormalizationEnvelope[] = [];
    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: compiler(calls),
      signal: new AbortController().signal,
    });
    expect(candidate.coverage).toEqual({
      eligibleDocuments: 0,
      normalizedDocuments: 0,
      sourceUnits: 0,
      complete: true,
    });
    expect(calls).toHaveLength(0);
  });

  it("keeps the GitHub pull-request title outside the normalized body", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".github"), { recursive: true });
    await writeFile(
      resolve(root, ".github/PULL_REQUEST_TEMPLATE.md"),
      "## Summary\n\n<!-- State the result. -->\n\n## Checklist\n\n- [ ] Verify the change.\n",
    );
    const observed: DocumentNormalizationEnvelope[] = [];
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        observed.push(envelope);
        return {
          ...normalizedResponse(envelope),
          documents: envelope.documents.map((document) => ({
            sourcePath: document.path,
            outputs: [
              {
                path: document.path,
                content: "# Pull request\n\n## Summary\n\nState the result.\n",
                coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
              },
            ],
          })),
        };
      },
    };

    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: normalizer,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
    expect(observed[0]?.documents[0]).toMatchObject({
      path: ".github/PULL_REQUEST_TEMPLATE.md",
      profile: "pull_request_template",
      constraints: {
        allowSiblingTopicSplit: false,
        headingPolicy: "forbid_h1",
      },
    });

    normalizer.normalize = async (envelope) => ({
      ...normalizedResponse(envelope),
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [
          {
            path: document.path,
            content:
              "## Summary\n\nState the result.\n\n## Checklist\n\n- [ ] Verify the change.\n",
            coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
          },
        ],
      })),
    });
    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    expect(candidate.items[0]).toMatchObject({
      profile: "pull_request_template",
      outputs: [{ path: ".github/PULL_REQUEST_TEMPLATE.md" }],
    });
    expect(candidate.items[0]?.outputs[0]?.content).not.toMatch(/^# /mu);
  });

  it("rewrites and splits documents with exact approvals, records lifecycle, and skips current outputs", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await mkdir(resolve(root, ".agents/skills/deploy-check"), { recursive: true });
    await writeFile(
      resolve(root, "docs/operations/runtime-guide.md"),
      "# Runtime notes\n\n## Start\n\nRun `pnpm start`.\n\n## Check\n\nVerify readiness.\n",
    );
    await writeFile(
      resolve(root, ".agents/skills/deploy-check/SKILL.md"),
      "---\nname: deploy-check\ndescription: Old deployment checker.\n---\n# Old skill\n\nInspect deployment status.\n",
    );
    const formatterIgnore = "vendor/\n";
    await writeFile(resolve(root, ".prettierignore"), formatterIgnore);
    const calls: DocumentNormalizationEnvelope[] = [];
    const normalizer = compiler(calls);

    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    expect(candidate).toMatchObject({
      coverage: { eligibleDocuments: 2, normalizedDocuments: 2, complete: true },
      assurance: "unreviewed",
    });
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
    const plan = await createDocumentNormalizationPlan({
      repositoryRoot: root,
      candidate,
      now: new Date("2026-08-24T01:00:00.000Z"),
    });
    expect(plan.status).toBe("review_required");
    expect(plan.operations).not.toContainEqual(
      expect.objectContaining({ path: ".prettierignore" }),
    );
    await expect(
      applyDocumentNormalizationPlan({
        plan,
        candidate,
        approvals: [],
        now: new Date("2026-08-24T01:00:00.000Z"),
        recordApplied: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_approval_required" });

    const receipt = await applyDocumentNormalizationPlan({
      plan,
      candidate,
      approvals: plan.items.map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
      now: new Date("2026-08-24T01:00:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(receipt).toMatchObject({
      operation: "normalize_documents",
      normalizedDocumentCount: 2,
      outputDocumentCount: 3,
    });
    expect(await readFile(resolve(root, "docs/operations/runtime-guide.md"), "utf8")).toContain(
      "Use the focused topics below",
    );
    expect(
      await readFile(resolve(root, "docs/operations/runtime-guide/start.md"), "utf8"),
    ).toContain("pnpm start");
    expect(await readFile(resolve(root, ".agents/skills/deploy-check/SKILL.md"), "utf8")).toContain(
      "name: deploy-check",
    );
    expect(await readFile(resolve(root, ".prettierignore"), "utf8")).toBe(formatterIgnore);
    await expect(
      access(resolve(root, ".lervo/knowledge/document-normalizations")),
    ).resolves.toBeUndefined();

    calls.length = 0;
    const current = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    expect(current.items).toEqual([]);
    expect(current.coverage.eligibleDocuments).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("rejects a skill rewrite that changes the portable skill identity", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".agents/skills/deploy-check"), { recursive: true });
    await writeFile(
      resolve(root, ".agents/skills/deploy-check/SKILL.md"),
      "---\nname: deploy-check\ndescription: Check deployment.\n---\n# Check\n\nInspect status.\n",
    );
    const invalid = compiler([]);
    invalid.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [
          {
            path: document.path,
            content: "---\nname: renamed-skill\ndescription: Changed.\n---\n# Changed\n",
            coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
          },
        ],
      })),
      telemetry: {
        filesystemReads: 0,
        filesystemWrites: 0,
        shellProcesses: 0,
        networkRequests: 0,
        externalActions: 0,
        toolCalls: 0,
        complete: true,
      },
    });

    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: invalid,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("rejects trailing whitespace introduced by a document normalizer", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(
      resolve(root, "docs/operations/runtime-guide.md"),
      "# Runtime notes\n\nKeep the runtime current.\n",
    );
    const invalid = compiler([]);
    invalid.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [
          {
            path: document.path,
            content: "# Runtime guide\n\nStatus: `active`  \n",
            coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
          },
        ],
      })),
      telemetry: {
        filesystemReads: 0,
        filesystemWrites: 0,
        shellProcesses: 0,
        networkRequests: 0,
        externalActions: 0,
        toolCalls: 0,
        complete: true,
      },
    });

    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: invalid,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("excludes the public root README from required normalization and preserves its bytes", async () => {
    const root = await repository();
    await writeFile(resolve(root, "README.md"), "# Project\n\nStart here.\n");
    const invalid = compiler([]);
    invalid.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [
          {
            path: document.path,
            content: "# Project\n\nStart here.\n\n",
            coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
          },
        ],
      })),
      telemetry: {
        filesystemReads: 0,
        filesystemWrites: 0,
        shellProcesses: 0,
        networkRequests: 0,
        externalActions: 0,
        toolCalls: 0,
        complete: true,
      },
    });

    const before = await readFile(resolve(root, "README.md"), "utf8");
    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: invalid,
      signal: new AbortController().signal,
    });
    expect(candidate.items).toEqual([]);
    expect(candidate.coverage.eligibleDocuments).toBe(0);
    expect(await readFile(resolve(root, "README.md"), "utf8")).toBe(before);
  });

  it("does not report a historical root README normalization as stale", async () => {
    const root = await repository();
    await writeFile(resolve(root, "README.md"), "# Current public README\n");
    const recordId = "knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa";
    const directory = resolve(root, ".lervo/knowledge/document-normalizations/aa");
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `${recordId}.yaml`),
      [
        `recordId: ${recordId}`,
        "schemaVersion: 1",
        "outputLanguage: en",
        "formatVersion: lervo.document.v1",
        "sourcePath: README.md",
        `sourceContentHash: ${sha256("# Historical public README\n")}`,
        "resourceBindings: []",
        "outputs:",
        "  - path: README.md",
        `    contentHash: ${sha256("# Historical public README\n")}`,
        "",
      ].join("\n"),
    );

    const lint = await lintRepositoryKnowledge(root);
    expect(lint.issues).not.toContainEqual(
      expect.objectContaining({ code: "document_normalization_stale" }),
    );
  });

  it("preserves repository lifecycle metadata byte-for-byte", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/roadmap"), { recursive: true });
    await writeFile(
      resolve(root, "docs/roadmap/v0.md"),
      "# Roadmap\n\nStatus: `complete`\nAs of: 2026-08-24\n\n## Scope\n\nDone.\n",
    );
    const invalid = compiler([]);
    invalid.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [
          {
            path: document.path,
            content:
              "# Roadmap\n\n- Status: `complete`\n- As of: 2026-08-24\n\n## Scope\n\nDone.\n",
            coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
          },
        ],
      })),
      telemetry: {
        filesystemReads: 0,
        filesystemWrites: 0,
        shellProcesses: 0,
        networkRequests: 0,
        externalActions: 0,
        toolCalls: 0,
        complete: true,
      },
    });

    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: invalid,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("uses the portable skill package directory as identity when legacy SKILL.md has no frontmatter", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".agents/skills/deploy-check"), { recursive: true });
    await writeFile(
      resolve(root, ".agents/skills/deploy-check/SKILL.md"),
      "# Legacy check\n\nInspect deployment status.\n",
    );
    const calls: DocumentNormalizationEnvelope[] = [];
    const normalizer = compiler(calls);

    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });

    expect(calls[0]?.documents[0]).toMatchObject({
      profile: "portable_skill",
      requiredSkillName: "deploy-check",
    });
    expect(candidate.items[0]?.outputs[0]?.content).toContain("name: deploy-check");
  });

  it("keeps agent routing outside the public README while rewriting internal non-portable wiki links", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/instructions"), { recursive: true });
    await writeFile(resolve(root, "README.md"), "# Project\n\nUse CLAUDE.md for development.\n");
    await writeFile(resolve(root, "AGENTS.md"), "# Agent instructions\n\nPreserve user work.\n");
    await writeFile(
      resolve(root, "docs/instructions/voice.md"),
      "# Voice\n\nFollow [[visual-language]].\n",
    );
    const observed: DocumentNormalizationEnvelope[] = [];
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        observed.push(envelope);
        return {
          schemaVersion: 1,
          documents: envelope.documents.map((document) => ({
            sourcePath: document.path,
            outputs: [
              {
                path: document.path,
                content:
                  document.path === "README.md"
                    ? "# Project\n\nRead AGENTS.md before development.\n"
                    : document.path.endsWith("voice.md")
                      ? "# Voice\n\nFollow [[visual-language]].\n"
                      : "# Agent instructions\n\nPreserve user work.\n",
                coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
              },
            ],
          })),
          telemetry: {
            filesystemReads: 0,
            filesystemWrites: 0,
            shellProcesses: 0,
            networkRequests: 0,
            externalActions: 0,
            toolCalls: 0,
            complete: true,
          },
        };
      },
    };

    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: normalizer,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
    expect(
      observed
        .flatMap((envelope) => envelope.documents)
        .find((document) => document.path === "README.md"),
    ).toBeUndefined();
    expect(
      observed
        .flatMap((envelope) => envelope.documents)
        .find((document) => document.path.endsWith("voice.md"))?.constraints,
    ).toMatchObject({ rewriteWikiLinksAsMarkdown: true });

    normalizer.normalize = async (envelope) => ({
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [
          {
            path: document.path,
            content:
              document.path === "README.md"
                ? "# Project\n\nRead the development guide.\n"
                : document.path.endsWith("voice.md")
                  ? "# Voice\n\nFollow [visual language](visual-language.md).\n"
                  : "# Agent instructions\n\nPreserve user work.\n",
            coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
          },
        ],
      })),
      telemetry: {
        filesystemReads: 0,
        filesystemWrites: 0,
        shellProcesses: 0,
        networkRequests: 0,
        externalActions: 0,
        toolCalls: 0,
        complete: true,
      },
    });
    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    expect(candidate.items.map((item) => item.sourcePath)).not.toContain("README.md");
    expect(await readFile(resolve(root, "README.md"), "utf8")).toBe(
      "# Project\n\nUse CLAUDE.md for development.\n",
    );
  });

  it("rejects a normalized repository document that changes a Markdown link target", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/architecture"), { recursive: true });
    await writeFile(
      resolve(root, "docs/architecture/system.md"),
      "# System\n\nSee [the decision](../decisions/0041-signed-command.md).\n",
    );
    const invalid: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        return {
          schemaVersion: 1,
          documents: envelope.documents.map((document) => ({
            sourcePath: document.path,
            outputs: [
              {
                path: document.path,
                content: "# System\n\nSee [the decision](../decisions/0041-command.md).\n",
                coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
              },
            ],
          })),
          telemetry: {
            filesystemReads: 0,
            filesystemWrites: 0,
            shellProcesses: 0,
            networkRequests: 0,
            externalActions: 0,
            toolCalls: 0,
            complete: true,
          },
        };
      },
    };

    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: invalid,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("requires split documents to rebase relative Markdown links to the same repository target", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/roadmap"), { recursive: true });
    await writeFile(
      resolve(root, "docs/roadmap/quality.md"),
      "# Quality\n\n## Evaluation history\n\nSee [evidence](../evidence/result.md).\n",
    );
    let correctlyRebased = false;
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        return {
          schemaVersion: 1,
          documents: envelope.documents.map((document) => ({
            sourcePath: document.path,
            outputs: [
              {
                path: document.path,
                content: "# Quality\n\nSee [evaluation history](quality/history.md).\n",
                coveredUnitIndexes: [document.sourceUnits[0]!.index],
              },
              {
                path: "docs/roadmap/quality/history.md",
                content: `# Evaluation history\n\nSee [evidence](${correctlyRebased ? "../../" : "../"}evidence/result.md).\n`,
                coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
              },
            ],
          })),
          telemetry: {
            filesystemReads: 0,
            filesystemWrites: 0,
            shellProcesses: 0,
            networkRequests: 0,
            externalActions: 0,
            toolCalls: 0,
            complete: true,
          },
        };
      },
    };

    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: normalizer,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });

    correctlyRebased = true;
    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    expect(candidate.items[0]?.outputs.map((output) => output.path)).toEqual([
      "docs/roadmap/quality.md",
      "docs/roadmap/quality/history.md",
    ]);
  });

  it("keeps lifecycle current across managed-block refreshes and replaces stale records", async () => {
    const root = await repository();
    const frontmatter = '---\ndescription: Repository instructions.\nglobs: "**/*.ts"\n---\n\n';
    const beforeBlock =
      "<!-- lervo:begin block=routes schema=1 -->\n- Read [old](docs/old.md).\n<!-- lervo:end block=routes -->";
    const afterBlock =
      "<!-- lervo:begin block=routes schema=1 -->\n- Read [new](docs/new.md).\n<!-- lervo:end block=routes -->";
    await writeFile(
      resolve(root, "AGENTS.md"),
      `${frontmatter}# Agent instructions\n\nPreserve user work.\n\n${beforeBlock}\n`,
    );
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        return {
          schemaVersion: 1,
          documents: envelope.documents.map((document) => ({
            sourcePath: document.path,
            outputs: [
              {
                path: document.path,
                content: `${frontmatter}# Agent instructions\n\nPreserve user work.\n\n${document.untrustedSourceData.includes("docs/new.md") ? afterBlock : beforeBlock}\n`,
                coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
              },
            ],
          })),
          telemetry: {
            filesystemReads: 0,
            filesystemWrites: 0,
            shellProcesses: 0,
            networkRequests: 0,
            externalActions: 0,
            toolCalls: 0,
            complete: true,
          },
        };
      },
    };
    const first = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    const firstPlan = await createDocumentNormalizationPlan({
      repositoryRoot: root,
      candidate: first,
      now: new Date("2026-08-24T02:00:00.000Z"),
    });
    await applyDocumentNormalizationPlan({
      plan: firstPlan,
      candidate: first,
      approvals: firstPlan.items.map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
      now: new Date("2026-08-24T02:00:00.000Z"),
      recordApplied: () => undefined,
    });

    await writeFile(
      resolve(root, "AGENTS.md"),
      `${frontmatter}# Agent instructions\n\nPreserve user work.\n\n${afterBlock}\n`,
    );
    const current = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    expect(current.items).toEqual([]);

    await writeFile(
      resolve(root, "AGENTS.md"),
      `${frontmatter}# Agent instructions\n\nPreserve user work and tests.\n\n${afterBlock}\n`,
    );
    const replacement = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    const replacementPlan = await createDocumentNormalizationPlan({
      repositoryRoot: root,
      candidate: replacement,
      now: new Date("2026-08-24T03:00:00.000Z"),
    });
    expect(
      replacementPlan.operations.filter((operation) => operation.action === "delete"),
    ).toHaveLength(1);
    const receipt = await applyDocumentNormalizationPlan({
      plan: replacementPlan,
      candidate: replacement,
      approvals: replacementPlan.items.map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
      now: new Date("2026-08-24T03:00:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(receipt.deleted).toHaveLength(1);
  });

  it("rejects an unsafe stored candidate even when its outer candidate ID is rebound", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(
      resolve(root, "docs/operations/runtime-guide.md"),
      "# Runtime notes\n\n## Start\n\nRun `pnpm start`.\n",
    );
    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: compiler([]),
      signal: new AbortController().signal,
    });
    const invalid = structuredClone(candidate);
    invalid.items[0]!.outputs[0]!.path = "../escape.md";
    const { schemaVersion: _schemaVersion, candidateId: _candidateId, ...materials } = invalid;
    invalid.candidateId = stableId("knorm", materials);
    const shard = invalid.candidateId.slice("knorm_".length, "knorm_".length + 2);
    const directory = resolve(root, ".lervo/state/knowledge/normalization-candidates", shard);
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, `${invalid.candidateId}.json`),
      `${JSON.stringify(invalid)}\n`,
    );

    await expect(
      loadDocumentNormalizationCandidate({
        repositoryRoot: root,
        candidateId: invalid.candidateId,
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
  });

  it("runs large normalization sets with bounded shard concurrency", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        writeFile(
          resolve(root, `docs/operations/guide-${String(index).padStart(2, "0")}.md`),
          `# Guide ${index}\n\nKeep this guide current.\n`,
        ),
      ),
    );
    let active = 0;
    let maximumActive = 0;
    let maximumDocuments = 0;
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        maximumDocuments = Math.max(maximumDocuments, envelope.documents.length);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        active -= 1;
        return {
          schemaVersion: 1,
          documents: envelope.documents.map((document) => ({
            sourcePath: document.path,
            outputs: [
              {
                path: document.path,
                content: `# Normalized ${document.path}\n`,
                coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
              },
            ],
          })),
          telemetry: {
            filesystemReads: 0,
            filesystemWrites: 0,
            shellProcesses: 0,
            networkRequests: 0,
            externalActions: 0,
            toolCalls: 0,
            complete: true,
          },
        };
      },
    };

    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });

    expect(candidate.items).toHaveLength(25);
    expect(maximumActive).toBe(3);
    expect(maximumDocuments).toBeLessThanOrEqual(2);
  });

  it("reuses an exact document result after an unrelated repository snapshot change", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(
      resolve(root, "docs/operations/cache.md"),
      "# Cache\n\nKeep the cache current.\n",
    );
    const calls: DocumentNormalizationEnvelope[] = [];
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        calls.push(envelope);
        return normalizedResponse(envelope);
      },
    };

    const first = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });
    expect(calls.map((envelope) => envelope.documents.length)).toEqual([1]);
    calls.length = 0;
    await writeFile(resolve(root, "runtime.ts"), "export const runtime = true;\n");
    const progress: string[] = [];
    const second = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
      onShardProgress: ({ status }) => progress.push(status),
    });

    expect(second.sourceSnapshotId).not.toBe(first.sourceSnapshotId);
    expect(second.items.map((item) => item.sourcePath)).toEqual(["docs/operations/cache.md"]);
    expect(calls).toHaveLength(0);
    expect(progress).toEqual(["started", "cache_hit"]);
  });

  it("splits a failed batch, persists each successful document, and retries only the missing document", async () => {
    const root = await repository();
    await mkdir(resolve(root, "docs/operations"), { recursive: true });
    await writeFile(resolve(root, "docs/operations/alpha.md"), "# Alpha\n\nKeep alpha current.\n");
    await writeFile(resolve(root, "docs/operations/beta.md"), "# Beta\n\nKeep beta current.\n");
    const calls: string[][] = [];
    let failBeta = true;
    const normalizer: RepositoryDocumentNormalizationCompiler = {
      descriptor: compiler([]).descriptor,
      async normalize(envelope) {
        const paths = envelope.documents.map((document) => document.path);
        calls.push(paths);
        if (paths.length > 1) throw new Error("bounded batch failure");
        if (failBeta && paths[0] === "docs/operations/beta.md") throw new Error("beta failure");
        return normalizedResponse(envelope);
      },
    };
    const firstProgress: string[] = [];

    await expect(
      compileConfiguredDocumentNormalizationCandidate({
        repositoryRoot: root,
        compiler: normalizer,
        signal: new AbortController().signal,
        onShardProgress: ({ status }) => firstProgress.push(status),
      }),
    ).rejects.toThrow("beta failure");
    expect(calls).toEqual([
      ["docs/operations/alpha.md", "docs/operations/beta.md"],
      ["docs/operations/alpha.md"],
      ["docs/operations/beta.md"],
    ]);
    expect(firstProgress).toContain("split_retry");

    failBeta = false;
    calls.length = 0;
    const secondProgress: Array<{ status: string; cached: number }> = [];
    const candidate = await compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
      onShardProgress: ({ status, cachedDocumentCount }) =>
        secondProgress.push({ status, cached: cachedDocumentCount }),
    });

    expect(candidate.items).toHaveLength(2);
    expect(calls).toEqual([["docs/operations/beta.md"]]);
    expect(secondProgress).toContainEqual({ status: "completed", cached: 1 });
  });
});
