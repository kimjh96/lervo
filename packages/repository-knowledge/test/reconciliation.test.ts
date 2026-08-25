import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  compileRepositoryKnowledgeCandidate,
  createKnowledgeReconciliationPlan,
  scanConfiguredRepositoryKnowledge,
  sha256,
  storeKnowledgeCompilationCandidate,
  type RepositorySemanticCompiler,
  type SemanticCompilerEnvelope,
  type SemanticCompilerResponse,
} from "../src/index.js";

const roots: string[] = [];

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-reconciliation-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Runtime\n\nThe runtime works without a Hub.\n");
  await writeFile(resolve(root, "main.ts"), "export function runLocal() { return true; }\n");
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_reconciliation",
      now: new Date("2026-08-22T00:00:00.000Z"),
    }),
  );
  await mkdir(resolve(root, ".lervo/knowledge/concepts"), { recursive: true });
  return root;
}

function compiler(
  response: (envelope: SemanticCompilerEnvelope) => SemanticCompilerResponse,
): RepositorySemanticCompiler {
  return {
    descriptor: {
      compilerId: "claude.semantic.fixture",
      compilerVersion: "1",
      compilerBuildId: `sha256:${"a".repeat(64)}`,
      provider: "claude",
      isolation: "external_no_capabilities",
    },
    compile: async (envelope) => response(envelope),
  };
}

function telemetry(): SemanticCompilerResponse["telemetry"] {
  return {
    filesystemReads: 0,
    filesystemWrites: 0,
    shellProcesses: 0,
    networkRequests: 0,
    externalActions: 0,
    toolCalls: 0,
    complete: true,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("semantic candidate reconciliation", () => {
  it("matches only source identity, creates a new concept, and proposes a relation deterministically", async () => {
    const root = await repository();
    const { policy, scan } = await scanConfiguredRepositoryKnowledge(root);
    const candidate = await compileRepositoryKnowledgeCandidate({
      scan,
      policyHash: sha256(canonicalJson(policy)),
      compiler: compiler((envelope) => {
        const readme = envelope.sourceUnits.find((unit) => unit.path === "README.md")!;
        const code = envelope.sourceUnits.find((unit) => unit.path === "main.ts")!;
        return {
          schemaVersion: 1,
          concepts: [
            {
              localKey: "runtime",
              title: "Renamed title must not drive identity",
              type: "concept",
              summary: "Runtime candidate.",
              claims: [
                {
                  localKey: "local",
                  statement: "The runtime works without a Hub.",
                  evidenceUnitVersionIds: [readme.unitVersionId],
                },
              ],
            },
            {
              localKey: "runner",
              title: "runLocal",
              type: "procedure",
              summary: "Local runner candidate.",
              claims: [
                {
                  localKey: "exported",
                  statement: "runLocal is exported.",
                  evidenceUnitVersionIds: [code.unitVersionId],
                },
              ],
            },
          ],
          relations: [
            {
              fromConceptKey: "runner",
              toConceptKey: "runtime",
              type: "related_to",
              evidenceUnitVersionIds: [readme.unitVersionId, code.unitVersionId],
            },
          ],
          telemetry: telemetry(),
        };
      }),
      signal: new AbortController().signal,
    });
    await storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate });
    await writeFile(
      resolve(root, ".lervo/knowledge/concepts/concept_existing00000000000000.yaml"),
      stringify({
        schemaVersion: 1,
        conceptId: "concept_existing00000000000000",
        title: "Existing runtime",
        path: "README.md",
        ownership: "user",
        sourceUnitVersionIds: [
          scan.units.find((unit) => unit.path === "README.md" && unit.unitKind === "file")!
            .unitVersionId,
        ],
      }),
    );
    const first = await createKnowledgeReconciliationPlan({
      repositoryRoot: root,
      compilationId: candidate.compilationId,
    });
    const second = await createKnowledgeReconciliationPlan({
      repositoryRoot: root,
      compilationId: candidate.compilationId,
    });
    expect(first).toEqual(second);
    expect(first.status).toBe("ready");
    expect(first.dispositions.map((item) => item.action).sort()).toEqual([
      "add_relation",
      "create_generated",
      "register_existing",
    ]);
    expect(first.dispositions.find((item) => item.action === "register_existing")).toMatchObject({
      existingConceptId: "concept_existing00000000000000",
      reasons: ["source_identity_match"],
    });
  });

  it("does not merge duplicate or contradictory candidates and rejects a stale source snapshot", async () => {
    const root = await repository();
    const { policy, scan } = await scanConfiguredRepositoryKnowledge(root);
    const candidate = await compileRepositoryKnowledgeCandidate({
      scan,
      policyHash: sha256(canonicalJson(policy)),
      compiler: compiler((envelope) => {
        const evidence = envelope.sourceUnits[0]!.unitVersionId;
        const sharedClaim = (localKey: string) => ({
          localKey,
          statement: "The same source-backed statement.",
          evidenceUnitVersionIds: [evidence],
        });
        return {
          schemaVersion: 1,
          concepts: [
            {
              localKey: "left",
              title: "Left",
              type: "concept",
              summary: "Left candidate.",
              claims: [sharedClaim("left_claim")],
            },
            {
              localKey: "right",
              title: "Right",
              type: "concept",
              summary: "Right candidate.",
              claims: [sharedClaim("right_claim")],
            },
          ],
          relations: [
            {
              fromConceptKey: "left",
              toConceptKey: "right",
              type: "contradicts",
              evidenceUnitVersionIds: [evidence],
            },
          ],
          telemetry: telemetry(),
        };
      }),
      signal: new AbortController().signal,
    });
    await storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate });
    const plan = await createKnowledgeReconciliationPlan({
      repositoryRoot: root,
      compilationId: candidate.compilationId,
    });
    expect(plan.status).toBe("review_required");
    expect(plan.dispositions.filter((item) => item.action === "conflict")).toHaveLength(3);
    expect(plan.dispositions.every((item) => item.review === "review_required")).toBe(true);
    expect(
      plan.dispositions.every(
        (item) =>
          item.resolutionOptions.length === 1 &&
          item.resolutionOptions[0]!.resolutionHash.startsWith("sha256:"),
      ),
    ).toBe(true);
    await writeFile(resolve(root, "README.md"), "# Runtime\n\nThe runtime changed.\n");
    await expect(
      createKnowledgeReconciliationPlan({
        repositoryRoot: root,
        compilationId: candidate.compilationId,
      }),
    ).rejects.toMatchObject({ code: "knowledge_plan_stale" });
  });

  it("turns multiple patches for one managed block into skip-only conflicts", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, "README.md"),
      "# Runtime\n\n<!-- lervo:begin block=repository-knowledge schema=1 -->\nOld summary.\n<!-- lervo:end block=repository-knowledge -->\n",
    );
    const { policy, scan } = await scanConfiguredRepositoryKnowledge(root);
    const readme = scan.units.find(
      (unit) => unit.path === "README.md" && unit.unitKind === "markdown_section",
    )!;
    const candidate = await compileRepositoryKnowledgeCandidate({
      scan,
      policyHash: sha256(canonicalJson(policy)),
      compiler: compiler(() => ({
        schemaVersion: 1,
        concepts: [
          {
            localKey: "runtime",
            title: "Runtime",
            type: "concept",
            summary: "Runtime summary.",
            claims: [
              {
                localKey: "local",
                statement: "The runtime is local.",
                evidenceUnitVersionIds: [readme.unitVersionId],
              },
            ],
          },
          {
            localKey: "operation",
            title: "Operation",
            type: "procedure",
            summary: "Operation summary.",
            claims: [
              {
                localKey: "start",
                statement: "The runtime has a start procedure.",
                evidenceUnitVersionIds: [readme.unitVersionId],
              },
            ],
          },
        ],
        relations: [],
        telemetry: telemetry(),
      })),
      signal: new AbortController().signal,
    });
    await storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate });
    await writeFile(
      resolve(root, ".lervo/knowledge/concepts/concept_existing00000000000000.yaml"),
      stringify({
        schemaVersion: 1,
        conceptId: "concept_existing00000000000000",
        title: "Existing runtime",
        path: "README.md",
        ownership: "user",
        sourceUnitVersionIds: [
          scan.units.find((unit) => unit.path === "README.md" && unit.unitKind === "file")!
            .unitVersionId,
        ],
      }),
    );
    const plan = await createKnowledgeReconciliationPlan({
      repositoryRoot: root,
      compilationId: candidate.compilationId,
    });
    expect(plan.status).toBe("conflict");
    expect(plan.dispositions.filter((item) => item.action === "register_existing")).toHaveLength(2);
    expect(plan.dispositions.filter((item) => item.subjectKind === "user_patch")).toEqual([
      expect.objectContaining({ action: "conflict", reasons: ["ambiguous_managed_block_target"] }),
      expect.objectContaining({ action: "conflict", reasons: ["ambiguous_managed_block_target"] }),
    ]);
    expect(plan.dispositions.some((item) => item.action === "propose_user_patch")).toBe(false);
  });
});
