import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { acquireRepositorySourceRead } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDurableKnowledgeOperations,
  authorizeCurrentRepositoryDocumentLayout,
  recoverKnowledgeMaterialization,
  sha256,
  type DurableKnowledgeDeleteOperation,
  type KnowledgeFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-durable-knowledge-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_durableknowledge" }));
  return root;
}

function createOperation(content = "after\n"): KnowledgeFileOperation {
  return {
    path: "docs/knowledge/semantic/concept_fixture.md",
    action: "create",
    ownership: "lervo_generated",
    mediaType: "text/markdown",
    content,
    desiredHash: sha256(content),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable semantic knowledge materialization", () => {
  it("defers a materialization while a live repository reader is active", async () => {
    const root = await repository();
    const operation = createOperation();
    const lease = await acquireRepositorySourceRead(root);
    const input = {
      repositoryRoot: root,
      projectId: "prj_durableknowledge",
      planId: `ksmat_${"f".repeat(24)}`,
      operations: [operation],
      documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
        repositoryRoot: root,
        operations: [operation],
      }),
      receipt: { ok: true },
      recordApplied: () => undefined,
    };
    try {
      await expect(applyDurableKnowledgeOperations(input)).rejects.toMatchObject({
        code: "knowledge_materialization_busy",
      });
      await expect(access(resolve(root, operation.path))).rejects.toThrow();
    } finally {
      lease.release();
    }
    await expect(applyDurableKnowledgeOperations(input)).resolves.toEqual({ ok: true });
    await expect(readFile(resolve(root, operation.path), "utf8")).resolves.toBe("after\n");
  });

  it("rejects a document mutation without a projected-layout permit", async () => {
    const root = await repository();
    await expect(
      applyDurableKnowledgeOperations({
        repositoryRoot: root,
        projectId: "prj_durableknowledge",
        planId: `ksmat_${"d".repeat(24)}`,
        operations: [createOperation()],
        receipt: { ok: true },
        recordApplied: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "document_layout_permit_required" });
  });

  it("recovers every pre/post-event interruption from the journal and event coordinate", async () => {
    const cases: Array<{ checkpoint: KnowledgeMaterializationCheckpoint; committed: boolean }> = [
      { checkpoint: "staged", committed: false },
      { checkpoint: "published:0", committed: false },
      { checkpoint: "event_recorded", committed: true },
      { checkpoint: "committed", committed: true },
    ];
    for (const [index, fixture] of cases.entries()) {
      const root = await repository();
      let eventRecorded = false;
      await expect(
        applyDurableKnowledgeOperations({
          repositoryRoot: root,
          projectId: "prj_durableknowledge",
          planId: `ksmat_${String(index + 1).repeat(24)}`,
          operations: [createOperation()],
          documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
            repositoryRoot: root,
            operations: [createOperation()],
          }),
          receipt: { ok: true },
          recordApplied: () => {
            eventRecorded = true;
          },
          failureInjector: (checkpoint) =>
            checkpoint === fixture.checkpoint ? "interrupt" : undefined,
        }),
      ).rejects.toMatchObject({ code: "knowledge_recovery_required" });
      expect(eventRecorded).toBe(fixture.committed);
      const result = await recoverKnowledgeMaterialization({
        repositoryRoot: root,
        eventRecorded: () => eventRecorded,
      });
      expect(result.disposition).toBe(fixture.committed ? "committed_cleanup" : "rolled_back");
      if (fixture.committed)
        await expect(readFile(resolve(root, createOperation().path), "utf8")).resolves.toBe(
          "after\n",
        );
      else await expect(access(resolve(root, createOperation().path))).rejects.toThrow();
      await expect(
        access(resolve(root, ".lervo/state/knowledge/materialization-transaction")),
      ).rejects.toThrow();
    }
  });

  it("restores an update interrupted after moving the original", async () => {
    const root = await repository();
    const path = "docs/knowledge/semantic/concept_fixture.md";
    await mkdir(resolve(root, "docs/knowledge/semantic"), { recursive: true });
    await writeFile(resolve(root, path), "before\n");
    const operation: KnowledgeFileOperation = {
      path,
      action: "update",
      ownership: "lervo_generated",
      mediaType: "text/markdown",
      content: "after\n",
      expectedCurrentHash: sha256("before\n"),
      desiredHash: sha256("after\n"),
    };
    await expect(
      applyDurableKnowledgeOperations({
        repositoryRoot: root,
        projectId: "prj_durableknowledge",
        planId: `ksmat_${"a".repeat(24)}`,
        operations: [operation],
        documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
          repositoryRoot: root,
          operations: [operation],
        }),
        receipt: { ok: true },
        recordApplied: () => undefined,
        failureInjector: (checkpoint) =>
          checkpoint === "original_moved:0" ? "interrupt" : undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_recovery_required" });
    expect(
      await recoverKnowledgeMaterialization({ repositoryRoot: root, eventRecorded: () => false }),
    ).toMatchObject({ disposition: "rolled_back" });
    expect(await readFile(resolve(root, path), "utf8")).toBe("before\n");
  });

  it("rolls back a synchronous event failure without leaving a marker", async () => {
    const root = await repository();
    await expect(
      applyDurableKnowledgeOperations({
        repositoryRoot: root,
        projectId: "prj_durableknowledge",
        planId: `ksmat_${"b".repeat(24)}`,
        operations: [createOperation()],
        documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
          repositoryRoot: root,
          operations: [createOperation()],
        }),
        receipt: { ok: true },
        recordApplied: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "knowledge_apply_failed" });
    await expect(access(resolve(root, createOperation().path))).rejects.toThrow();
    await expect(
      access(resolve(root, ".lervo/state/knowledge/materialization-transaction")),
    ).rejects.toThrow();
  });

  it("recreates a pruned shard directory before restoring a deleted file", async () => {
    const root = await repository();
    const path = ".lervo/knowledge/concepts/aa/concept_aaaaaaaaaaaaaaaaaaaaaaaa.yaml";
    const content = "fixture: true\n";
    await mkdir(resolve(root, ".lervo/knowledge/concepts/aa"), { recursive: true });
    await writeFile(resolve(root, path), content);
    const operation: DurableKnowledgeDeleteOperation = {
      path,
      action: "delete",
      expectedCurrentHash: sha256(content),
    };

    await expect(
      applyDurableKnowledgeOperations({
        repositoryRoot: root,
        projectId: "prj_durableknowledge",
        planId: `ksmat_${"c".repeat(24)}`,
        operations: [operation],
        receipt: { ok: true },
        recordApplied: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "knowledge_apply_failed" });

    expect(await readFile(resolve(root, path), "utf8")).toBe(content);
    await expect(
      access(resolve(root, ".lervo/state/knowledge/materialization-transaction")),
    ).rejects.toThrow();
  });
});
