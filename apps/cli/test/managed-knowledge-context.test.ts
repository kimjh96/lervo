import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan, loadDocumentRegistry } from "@lervo/project";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
} from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { prepareManagedSearchContext } from "../src/managed-search-context.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed repository knowledge context", () => {
  it("creates a separate observed attempt and provider-context candidates with bounded metadata", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-knowledge-"));
    roots.push(root);
    await writeFile(root + "/README.md", "# Runtime\n\nManaged provider execution stays local-first.\n");
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_managedknowledge" }));
    const plan = await createKnowledgeMigrationPlan({ repositoryRoot: root });
    await applyKnowledgeMigrationPlan(plan, new Date("2026-08-22T01:00:00Z"), () => undefined);

    const prepared = await prepareManagedSearchContext({
      repositoryRoot: root,
      projectId: "prj_managedknowledge",
      query: "managed provider local first runtime",
      fallbackQuery: "README.md",
      observedAt: new Date("2026-08-22T01:01:00Z"),
      nonce: "d".repeat(32),
      documentRegistry: await loadDocumentRegistry(root),
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
  });
});
