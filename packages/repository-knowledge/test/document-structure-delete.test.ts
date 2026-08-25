import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyKnowledgeDocumentDeletionPlan,
  applyKnowledgeMigrationPlan,
  createKnowledgeDocumentDeletionPlan,
  createKnowledgeMigrationPlan,
  recoverKnowledgeMaterialization,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<{
  root: string;
  documentPath: string;
  documentBytes: string;
}> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-document-structure-delete-"));
  roots.push(root);
  const documentPath = "retired.md";
  const documentBytes = "# Retired\n\nThese exact bytes must survive rollback.\n";
  await writeFile(resolve(root, documentPath), documentBytes);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_structure_delete",
      now: new Date("2026-08-23T00:00:00.000Z"),
    }),
  );
  const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  await applyKnowledgeMigrationPlan(
    migration,
    new Date("2026-08-23T00:01:00.000Z"),
    () => undefined,
  );
  return { root, documentPath, documentBytes };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("user document structure deletion", () => {
  it("restores the document and sidecar byte-for-byte after an interrupted delete", async () => {
    const { root, documentPath, documentBytes } = await repository();
    const plan = await createKnowledgeDocumentDeletionPlan({ repositoryRoot: root, documentPath });
    const sidecar = plan.operations.find((operation) => operation.action === "update")!.path;
    const sidecarBefore = await readFile(resolve(root, sidecar));
    const last = plan.operations.length - 1;
    await expect(
      applyKnowledgeDocumentDeletionPlan({
        plan,
        approvedOperationId: plan.operationId,
        approvedHash: plan.approvalHash,
        now: new Date("2026-08-23T00:02:00.000Z"),
        recordApplied: () => undefined,
        failureInjector: (checkpoint) =>
          checkpoint === `published:${last}` ? "interrupt" : undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_recovery_required" });

    const recovered = await recoverKnowledgeMaterialization({
      repositoryRoot: root,
      eventRecorded: () => false,
    });
    expect(recovered).toMatchObject({ planId: plan.planId, disposition: "rolled_back" });
    expect(await readFile(resolve(root, documentPath), "utf8")).toBe(documentBytes);
    expect(await readFile(resolve(root, sidecar))).toEqual(sidecarBefore);
    expect(
      (await createKnowledgeDocumentDeletionPlan({ repositoryRoot: root, documentPath })).planId,
    ).toBe(plan.planId);
  });

  it("rolls back every byte when the required event recorder fails", async () => {
    const { root, documentPath, documentBytes } = await repository();
    const plan = await createKnowledgeDocumentDeletionPlan({ repositoryRoot: root, documentPath });
    const sidecar = plan.operations.find((operation) => operation.action === "update")!.path;
    const sidecarBefore = await readFile(resolve(root, sidecar));
    await expect(
      applyKnowledgeDocumentDeletionPlan({
        plan,
        approvedOperationId: plan.operationId,
        approvedHash: plan.approvalHash,
        now: new Date("2026-08-23T00:02:00.000Z"),
        recordApplied: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "knowledge_apply_failed" });
    expect(await readFile(resolve(root, documentPath), "utf8")).toBe(documentBytes);
    expect(await readFile(resolve(root, sidecar))).toEqual(sidecarBefore);
  });

  it("rejects unregistered, generated, and repository-external targets without deleting bytes", async () => {
    const { root } = await repository();
    await writeFile(resolve(root, "unregistered.md"), "# Unregistered\n");
    await expect(
      createKnowledgeDocumentDeletionPlan({
        repositoryRoot: root,
        documentPath: "unregistered.md",
      }),
    ).rejects.toMatchObject({ code: "knowledge_reconciliation_conflict" });
    await expect(
      createKnowledgeDocumentDeletionPlan({
        repositoryRoot: root,
        documentPath: "docs/knowledge/index.md",
      }),
    ).rejects.toMatchObject({ code: "knowledge_reconciliation_conflict" });
    await expect(
      createKnowledgeDocumentDeletionPlan({ repositoryRoot: root, documentPath: "../outside.md" }),
    ).rejects.toMatchObject({ code: "knowledge_source_unsafe" });
    expect(await readFile(resolve(root, "unregistered.md"), "utf8")).toBe("# Unregistered\n");
  });
});
