import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan, loadDocumentRegistry } from "@lervo/project";
import {
  documentIdForPath,
  prepareContext,
} from "@lervo/context";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
} from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { prepareManagedSearchContext } from "../src/managed-search-context.js";
import { createDeveloperRole } from "../src/developer-role.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed repository knowledge context", () => {
  it("creates a separate observed attempt and provider-context candidates with bounded metadata", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-knowledge-"));
    roots.push(root);
    await writeFile(root + "/README.md", "# Runtime\n\nManaged provider execution stays local-first.\n");
    await writeFile(root + "/AGENTS.md", "# Agent instructions\n\nKeep managed provider runtime work local first.\n");
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_managedknowledge" }));
    const plan = await createKnowledgeMigrationPlan({ repositoryRoot: root });
    await applyKnowledgeMigrationPlan(plan, new Date("2026-08-22T01:00:00Z"), () => undefined);

    const documentRegistry = await loadDocumentRegistry(root);
    const prepared = await prepareManagedSearchContext({
      repositoryRoot: root,
      projectId: "prj_managedknowledge",
      query: "managed provider local first runtime",
      fallbackQuery: "README.md",
      observedAt: new Date("2026-08-22T01:01:00Z"),
      nonce: "d".repeat(32),
      documentRegistry,
      expectedPaths: ["src/result.ts"],
    });

    expect(prepared.attempts).toHaveLength(2);
    expect(prepared.knowledgeAttempt.attemptId).not.toBe(prepared.attempt.attemptId);
    expect(prepared.recommendationBatches).toHaveLength(2);
    expect(prepared.additionalCandidates.length).toBeGreaterThan(0);
    expect(prepared.additionalCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "knowledge",
        knowledgeContext: expect.objectContaining({
          sourceSnapshotId: plan.sourceSnapshotId,
          impactReportId: expect.stringMatching(/^kimpact_[a-f0-9]{24}$/),
          assurance: "unreviewed",
          freshness: "current",
        }),
      }),
    ]));
    expect(prepared.recommendationBatches[1]!.recommendations.length).toBeGreaterThan(0);
    expect(prepared.additionalCandidates.find((candidate) => candidate.path === "AGENTS.md"))
      .toMatchObject({ documentId: documentIdForPath("AGENTS.md"), source: "knowledge" });

    const role = createDeveloperRole([], ["managed.knowledge.fixture"]);
    const loaded = await prepareContext({
      repositoryRoot: root,
      sourceRevision: "fixture-managed-knowledge-v1",
      coordinates: {
        projectId: "prj_managedknowledge",
        runId: "run_managedknowledge",
        sessionId: "ses_managedknowledge",
        roleId: role.roleId,
      },
      registry: documentRegistry,
      role,
      expectedPaths: ["src/result.ts"],
      documentRules: {},
      publications: [],
      handoffs: [],
      recommendationBatches: prepared.recommendationBatches,
      additionalCandidates: prepared.additionalCandidates,
      policyVersion: `sha256:${"0".repeat(64)}`,
      recordedAt: new Date("2026-08-22T01:02:00Z"),
    });
    const agentsDocuments = loaded.documents.filter((document) => document.path === "AGENTS.md");
    expect(agentsDocuments).toHaveLength(1);
    expect(agentsDocuments[0]?.knowledgeContext).toBeDefined();
    expect(loaded.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        documentId: documentIdForPath("AGENTS.md"),
        state: "discovered",
        knowledgeContext: agentsDocuments[0]?.knowledgeContext,
      }),
    ]));
  });
});
