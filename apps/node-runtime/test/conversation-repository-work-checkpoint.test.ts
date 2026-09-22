import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import {
  applyWorkstreamStartPlan,
  createWorkstreamStartPlan,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge/workstream";
import { afterEach, expect, it } from "vitest";

import { reconcileConversationRepositoryWorkCheckpoint } from "../src/conversation-repository-work-checkpoint.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-checkpoint-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_conversation_checkpoint",
      now: new Date("2026-09-22T00:00:00.000Z"),
    }),
  );
  const storage = await openProjectStorage(root);
  try {
    const plan = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: storage.manifest.projectId,
      draft: {
        schemaVersion: 1,
        status: "active",
        title: "Conversation work",
        objective: "Complete one managed conversation request.",
        nextActions: ["Perform the requested work."],
        blockers: [],
        notes: [],
        references: [],
        updatedAt: "2026-09-22T00:00:01.000Z",
      },
    });
    const identity = randomUUID().replaceAll("-", "");
    await applyWorkstreamStartPlan({
      plan,
      now: new Date("2026-09-22T00:00:01.000Z"),
      actor: "agent",
      recordApplied: async (applied, snapshotContent) => {
        const artifact = await storage.artifacts.put(snapshotContent);
        storage.events.append({
          eventId: `evt_${identity}`,
          projectId: applied.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "workstream.snapshot.recorded",
          occurredAt: applied.appliedAt,
          actor: { kind: "agent", provider: "claude" },
          schemaVersion: 1,
          policyVersion: artifact.contentHash,
          payload: {
            workstreamId: applied.workstreamId,
            revision: applied.revision,
            status: applied.status,
            changeKind: applied.operation,
            snapshotArtifactId: `art_${artifact.contentHash.slice("sha256:".length)}`,
            snapshotContentHash: artifact.contentHash,
            previousSnapshotContentHash: applied.previousSnapshotContentHash,
            sourceArtifactId: null,
            sourceContentHash: null,
            recordedAt: applied.appliedAt,
          },
        });
      },
    });
  } finally {
    await storage.close();
  }
  return root;
}

it("records one host checkpoint after successful changed work and does not advance it twice", async () => {
  const root = await repository();
  const initial = (await readCurrentWorkstreamState(root))!;
  const input = {
    repositoryRoot: root,
    provider: "claude" as const,
    baseline: {
      workstreamId: initial.snapshot.workstreamId,
      workstreamRevision: initial.snapshot.revision,
      knowledgeCurrent: true,
    },
    repositoryChange: {
      repositoryRevisionBefore: `sha256:${"1".repeat(64)}`,
      repositoryRevisionAfter: `sha256:${"2".repeat(64)}`,
      changedPaths: ["apps/site/page.tsx", "README.md"],
    },
    completedAt: "2026-09-22T00:01:00.000Z",
  };

  await expect(reconcileConversationRepositoryWorkCheckpoint(input)).resolves.toBe(
    "host_checkpoint",
  );
  const recovered = (await readCurrentWorkstreamState(root))!;
  expect(recovered.snapshot).toMatchObject({
    workstreamId: initial.snapshot.workstreamId,
    revision: 2,
    updatedAt: input.completedAt,
  });
  expect(recovered.snapshot.notes.at(-1)).toContain("changed 2 paths");
  await expect(reconcileConversationRepositoryWorkCheckpoint(input)).resolves.toBe(
    "provider_checkpoint",
  );
  expect((await readCurrentWorkstreamState(root))!.snapshot.revision).toBe(2);
});

it("does not create bookkeeping for a zero-change provider result", async () => {
  const root = await repository();
  const initial = (await readCurrentWorkstreamState(root))!;
  await expect(
    reconcileConversationRepositoryWorkCheckpoint({
      repositoryRoot: root,
      provider: "codex",
      baseline: {
        workstreamId: initial.snapshot.workstreamId,
        workstreamRevision: initial.snapshot.revision,
        knowledgeCurrent: true,
      },
      repositoryChange: {
        repositoryRevisionBefore: `sha256:${"1".repeat(64)}`,
        repositoryRevisionAfter: `sha256:${"1".repeat(64)}`,
        changedPaths: [],
      },
      completedAt: "2026-09-22T00:01:00.000Z",
    }),
  ).resolves.toBe("not_needed");
  expect((await readCurrentWorkstreamState(root))!.snapshot.revision).toBe(1);
});
