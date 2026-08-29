import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyKnowledgeDocumentMovePlan,
  applyKnowledgeDocumentDeletionPlan,
  applyKnowledgeMigrationPlan,
  createKnowledgeDocumentDeletionPlan,
  createKnowledgeDocumentMovePlan,
  createKnowledgeMigrationPlan,
  lintRepositoryKnowledge,
  queryRepositoryKnowledge,
  recoverKnowledgeMaterialization,
  shardedKnowledgeArtifactPath,
} from "../src/index.js";
import { projectRepositoryPrettierRewrite } from "../src/prettier-rewriter-adapter.js";

const roots: string[] = [];

async function repository(): Promise<{ root: string; sourcePath: string; bytes: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-document-structure-move-"));
  roots.push(root);
  const sourcePath = "old-note.md";
  const bytes = "# Durable note\n\nThese exact user bytes move without changing identity.\n";
  await writeFile(resolve(root, sourcePath), bytes);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_structure_move",
      now: new Date("2026-08-23T00:00:00.000Z"),
    }),
  );
  const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  await applyKnowledgeMigrationPlan(
    migration,
    new Date("2026-08-23T00:01:00.000Z"),
    () => undefined,
  );
  return { root, sourcePath, bytes };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("user document structure move", () => {
  it("moves exact rewrite ownership to the destination in the same plan", async () => {
    const { root, sourcePath, bytes } = await repository();
    const destinationPath = "notes/current-note.md";
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const recordId = "knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa";
    const recordPath = shardedKnowledgeArtifactPath(
      ".lervo/knowledge/document-normalizations",
      recordId,
      "yaml",
    );
    await mkdir(dirname(resolve(root, recordPath)), { recursive: true });
    await writeFile(
      resolve(root, recordPath),
      [
        "byteOwnership:",
        "  owner: reviewer",
        "  rewritePolicy: reviewed_exact",
        "formatVersion: lervo.document.v1",
        "outputLanguage: en",
        "outputs:",
        `  - contentHash: ${contentHash}`,
        `    path: ${sourcePath}`,
        "resourceBindings: []",
        `recordId: ${recordId}`,
        "schemaVersion: 2",
        `sourcePath: ${sourcePath}`,
        "",
      ].join("\n"),
    );
    const currentRewrite = await projectRepositoryPrettierRewrite({
      repositoryRoot: root,
      ownedPaths: [sourcePath],
    });
    await writeFile(resolve(root, ".prettierignore"), currentRewrite.afterContent);

    const plan = await createKnowledgeDocumentMovePlan({
      repositoryRoot: root,
      fromPath: sourcePath,
      toPath: destinationPath,
    });
    const prettierOperation = plan.operations.find(
      (item) => item.action === "update" && item.path === ".prettierignore",
    );

    expect(prettierOperation).toHaveProperty("content");
    if (prettierOperation === undefined || !("content" in prettierOperation)) {
      throw new TypeError("The document move did not project exact rewrite ownership.");
    }
    expect(prettierOperation?.content).toContain(destinationPath);
    expect(prettierOperation?.content).not.toContain(`${sourcePath}\n`);
  });

  it("moves exact bytes while preserving concept and source-unit identity", async () => {
    const { root, sourcePath, bytes } = await repository();
    const destinationPath = "notes/current-note.md";
    const plan = await createKnowledgeDocumentMovePlan({
      repositoryRoot: root,
      fromPath: sourcePath,
      toPath: destinationPath,
    });
    const conceptId = plan.preservedConceptIds[0]!;
    const conceptPath = shardedKnowledgeArtifactPath(
      ".lervo/knowledge/concepts",
      conceptId,
      "yaml",
    );
    const conceptBefore = await readFile(resolve(root, conceptPath), "utf8");
    await applyKnowledgeDocumentMovePlan({
      plan,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-08-23T00:02:00.000Z"),
      recordApplied: () => undefined,
    });

    await expect(access(resolve(root, sourcePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(root, destinationPath), "utf8")).toBe(bytes);
    const conceptAfter = await readFile(resolve(root, conceptPath), "utf8");
    expect(conceptAfter).not.toBe(conceptBefore);
    expect(conceptAfter).toContain(`path: ${destinationPath}`);
    expect((await lintRepositoryKnowledge(root)).valid).toBe(true);
    expect(
      (await queryRepositoryKnowledge({ repositoryRoot: root, query: "Durable note" })).hits[0],
    ).toMatchObject({ conceptId, path: destinationPath });
    const refresh = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "refresh" });
    expect(refresh.operations.filter((item) => item.action !== "unchanged")).toEqual([]);
  });

  it("rolls back source, lineage, and generated navigation after an interrupted move", async () => {
    const { root, sourcePath, bytes } = await repository();
    const destinationPath = "notes/current-note.md";
    const plan = await createKnowledgeDocumentMovePlan({
      repositoryRoot: root,
      fromPath: sourcePath,
      toPath: destinationPath,
    });
    const last =
      plan.operations.filter(
        (item) => item.action === "create" || item.action === "update" || item.action === "move",
      ).length - 1;
    await expect(
      applyKnowledgeDocumentMovePlan({
        plan,
        approvedOperationId: plan.operationId,
        approvedHash: plan.approvalHash,
        now: new Date("2026-08-23T00:02:00.000Z"),
        recordApplied: () => undefined,
        failureInjector: (checkpoint) =>
          checkpoint === `published:${last}` ? "interrupt" : undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_recovery_required" });
    expect(
      (await recoverKnowledgeMaterialization({ repositoryRoot: root, eventRecorded: () => false }))
        .disposition,
    ).toBe("rolled_back");
    expect(await readFile(resolve(root, sourcePath), "utf8")).toBe(bytes);
    await expect(access(resolve(root, destinationPath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (
        await createKnowledgeDocumentMovePlan({
          repositoryRoot: root,
          fromPath: sourcePath,
          toPath: destinationPath,
        })
      ).planId,
    ).toBe(plan.planId);
  });

  it("rolls back the move when the required event recorder fails", async () => {
    const { root, sourcePath, bytes } = await repository();
    const destinationPath = "notes/current-note.md";
    const plan = await createKnowledgeDocumentMovePlan({
      repositoryRoot: root,
      fromPath: sourcePath,
      toPath: destinationPath,
    });
    await expect(
      applyKnowledgeDocumentMovePlan({
        plan,
        approvedOperationId: plan.operationId,
        approvedHash: plan.approvalHash,
        now: new Date("2026-08-23T00:02:00.000Z"),
        recordApplied: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "knowledge_apply_failed" });
    expect(await readFile(resolve(root, sourcePath), "utf8")).toBe(bytes);
    await expect(access(resolve(root, destinationPath))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when a persisted move-lineage sidecar is tampered", async () => {
    const { root, sourcePath } = await repository();
    const plan = await createKnowledgeDocumentMovePlan({
      repositoryRoot: root,
      fromPath: sourcePath,
      toPath: "current.md",
    });
    await applyKnowledgeDocumentMovePlan({
      plan,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-08-23T00:02:00.000Z"),
      recordApplied: () => undefined,
    });
    await writeFile(
      resolve(root, `.lervo/knowledge/source-lineage/${plan.lineageId}.yaml`),
      "schemaVersion: 1\nkind: document_move\n",
    );
    await expect(
      createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "refresh" }),
    ).rejects.toMatchObject({ code: "knowledge_source_unsafe" });
  });

  it("keeps one identity across chained moves and rejects collisions or instruction-boundary changes", async () => {
    const { root, sourcePath } = await repository();
    const first = await createKnowledgeDocumentMovePlan({
      repositoryRoot: root,
      fromPath: sourcePath,
      toPath: "middle.md",
    });
    await applyKnowledgeDocumentMovePlan({
      plan: first,
      approvedOperationId: first.operationId,
      approvedHash: first.approvalHash,
      now: new Date("2026-08-23T00:02:00.000Z"),
      recordApplied: () => undefined,
    });
    const second = await createKnowledgeDocumentMovePlan({
      repositoryRoot: root,
      fromPath: "middle.md",
      toPath: "final.md",
    });
    expect(second.preservedConceptIds).toEqual(first.preservedConceptIds);
    await applyKnowledgeDocumentMovePlan({
      plan: second,
      approvedOperationId: second.operationId,
      approvedHash: second.approvalHash,
      now: new Date("2026-08-23T00:03:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(
      (await queryRepositoryKnowledge({ repositoryRoot: root, query: "Durable note" })).hits[0],
    ).toMatchObject({ conceptId: first.preservedConceptIds[0], path: "final.md" });
    const deletion = await createKnowledgeDocumentDeletionPlan({
      repositoryRoot: root,
      documentPath: "final.md",
    });
    await applyKnowledgeDocumentDeletionPlan({
      plan: deletion,
      approvedOperationId: deletion.operationId,
      approvedHash: deletion.approvalHash,
      now: new Date("2026-08-23T00:04:00.000Z"),
      recordApplied: () => undefined,
    });
    await writeFile(
      resolve(root, "final.md"),
      "# Reused path\n\nThis is a new document identity.\n",
    );
    const reuseRefresh = await createKnowledgeMigrationPlan({
      repositoryRoot: root,
      mode: "refresh",
    });
    await applyKnowledgeMigrationPlan(
      reuseRefresh,
      new Date("2026-08-23T00:05:00.000Z"),
      () => undefined,
    );
    expect(
      (await queryRepositoryKnowledge({ repositoryRoot: root, query: "Reused path" })).hits[0]
        ?.conceptId,
    ).not.toBe(first.preservedConceptIds[0]);
    await writeFile(resolve(root, "occupied.md"), "# Occupied\n");
    await expect(
      createKnowledgeDocumentMovePlan({
        repositoryRoot: root,
        fromPath: "final.md",
        toPath: "occupied.md",
      }),
    ).rejects.toMatchObject({ code: "knowledge_reconciliation_conflict" });
    await expect(
      createKnowledgeDocumentMovePlan({
        repositoryRoot: root,
        fromPath: "final.md",
        toPath: "AGENTS.md",
      }),
    ).rejects.toMatchObject({ code: "knowledge_reconciliation_conflict" });
  }, 10_000);
});
