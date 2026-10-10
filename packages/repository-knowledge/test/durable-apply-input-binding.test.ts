import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDurableKnowledgeOperations,
  recoverKnowledgeMaterialization,
  sha256,
  type DurableKnowledgeBinaryFileOperation,
  type DurableKnowledgeDeleteOperation,
  type DurableKnowledgeMoveOperation,
  type DurableKnowledgeUserFileOperation,
} from "../src/index.js";

const roots: string[] = [];
const projectId = "prj_durableinputbinding";
const planId = `ksmat_${"e".repeat(24)}`;

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-durable-input-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId }));
  return root;
}

function createOperation(): DurableKnowledgeUserFileOperation {
  return {
    path: "created.txt",
    action: "create",
    ownership: "user",
    mediaType: "text/plain",
    content: "accepted\n",
    desiredHash: sha256("accepted\n"),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("durable knowledge input binding", () => {
  it.each(["create", "delete", "move"] as const)(
    "preserves unrelated files when a staged %s operation is redirected",
    async (action) => {
      const root = await repository();
      await writeFile(resolve(root, "unrelated.txt"), "user content\n");
      await writeFile(resolve(root, "original.txt"), "original\n");
      const operation:
        | DurableKnowledgeUserFileOperation
        | DurableKnowledgeDeleteOperation
        | DurableKnowledgeMoveOperation =
        action === "create"
          ? createOperation()
          : action === "delete"
            ? { action, path: "original.txt", expectedCurrentHash: sha256("original\n") }
            : {
                action,
                path: "original.txt",
                destinationPath: "moved.txt",
                expectedCurrentHash: sha256("original\n"),
              };
      const result = await applyDurableKnowledgeOperations({
        repositoryRoot: root,
        projectId,
        planId,
        operations: [operation],
        receipt: { ok: true },
        recordApplied: () => undefined,
        failureInjector: (checkpoint) => {
          if (checkpoint === "staged") {
            if (operation.action === "move") operation.destinationPath = "unrelated.txt";
            else operation.path = "unrelated.txt";
          }
        },
      }).catch((error: unknown) => error);
      expect(await readFile(resolve(root, "unrelated.txt"), "utf8")).toBe("user content\n");
      expect(result).toEqual({ ok: true });
      if (action === "create")
        expect(await readFile(resolve(root, "created.txt"), "utf8")).toBe("accepted\n");
      else {
        await expect(access(resolve(root, "original.txt"))).rejects.toThrow();
        if (action === "move")
          expect(await readFile(resolve(root, "moved.txt"), "utf8")).toBe("original\n");
      }
    },
  );

  it("captures the operation list and bytes before waiting for the source gate", async () => {
    const root = await repository();
    const operation: DurableKnowledgeBinaryFileOperation = {
      path: "runtime.bin",
      action: "create",
      ownership: "lervo_generated",
      mediaType: "application/octet-stream",
      content: Uint8Array.from([0, 1, 255]),
      desiredHash: sha256(Uint8Array.from([0, 1, 255])),
    };
    const operations = [operation];
    const pending = applyDurableKnowledgeOperations({
      repositoryRoot: root,
      projectId,
      planId,
      operations,
      receipt: { ok: true },
      recordApplied: () => undefined,
    });
    operation.content.fill(7);
    operation.desiredHash = sha256(operation.content);
    operations.length = 0;
    await expect(pending).resolves.toEqual({ ok: true });
    expect(await readFile(resolve(root, "runtime.bin"))).toEqual(Buffer.from([0, 1, 255]));
  });

  it("captures the recovery root before waiting for the source gate", async () => {
    const root = await repository();
    const otherRoot = await repository();
    await expect(
      applyDurableKnowledgeOperations({
        repositoryRoot: root,
        projectId,
        planId,
        operations: [createOperation()],
        receipt: { ok: true },
        recordApplied: () => undefined,
        failureInjector: (checkpoint) => (checkpoint === "published:0" ? "interrupt" : undefined),
      }),
    ).rejects.toMatchObject({ code: "knowledge_recovery_required" });
    const input = { repositoryRoot: root, eventRecorded: () => false };
    const pending = recoverKnowledgeMaterialization(input);
    input.repositoryRoot = otherRoot;
    await expect(pending).resolves.toMatchObject({ disposition: "rolled_back", planId });
    await expect(access(resolve(root, "created.txt"))).rejects.toThrow();
  });
});
