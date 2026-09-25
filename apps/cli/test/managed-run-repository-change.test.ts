import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ProjectStorage } from "@lervo/project-storage";
import { REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { recordManagedRunRepositoryChange } from "../src/managed-run-repository-change.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = (fill: string) => `sha256:${fill.repeat(64)}`;
const projectId = "prj_0123456789abcdef";

async function storage(version: 2 | 3) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-change-"));
  roots.push(root);
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: version,
  });
  return {
    manifest: { projectId },
    writableEventSchemaVersion: version,
    events,
    artifacts: {
      put: async (content: string) => ({
        contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      }),
    },
  } as unknown as ProjectStorage;
}

const input = (store: ProjectStorage, managedChanges: object[]) => ({
  storage: store,
  runId: "run_0123456789abcdef0123456789abcdef",
  sessionId: "ses_0123456789abcdef0123456789abcdef",
  policyVersion: hash("a"),
  completion: {
    terminalEventId: "evt_fedcba9876543210fedcba9876543210",
    beforeRevision: hash("b"),
    afterRevision: hash("c"),
    managedChanges: managedChanges as never,
  },
  eventId: "evt_0123456789abcdef0123456789abcdef",
  occurredAt: "2026-09-25T09:00:00.000Z",
});

it("queues one background knowledge job for a changed managed run", async () => {
  const store = await storage(3);
  try {
    const result = await recordManagedRunRepositoryChange(
      input(store, [
        { path: "docs/a.md", beforeHash: hash("1"), afterHash: hash("2"), changeKind: "modified" },
        { path: "src/new.ts", beforeHash: null, afterHash: hash("3"), changeKind: "created" },
      ]),
    );
    expect(result).toEqual({ eventId: "evt_0123456789abcdef0123456789abcdef", enqueued: true });
    expect(store.events.get(result!.eventId)?.payload).toMatchObject({
      sourceKind: "managed_run",
      sourceEventId: "evt_fedcba9876543210fedcba9876543210",
      changedPaths: ["docs/a.md", "src/new.ts"],
    });
    expect(store.events.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(1);
  } finally {
    store.events.close();
  }
});

it("records nothing for an unchanged run or a writer without v3 events", async () => {
  const unchanged = await storage(3);
  const legacy = await storage(2);
  try {
    expect(await recordManagedRunRepositoryChange(input(unchanged, []))).toBeNull();
    expect(
      await recordManagedRunRepositoryChange(
        input(legacy, [
          { path: "a.md", beforeHash: null, afterHash: hash("2"), changeKind: "created" },
        ]),
      ),
    ).toBeNull();
    expect(legacy.events.latest()).toBeNull();
  } finally {
    unchanged.events.close();
    legacy.events.close();
  }
});
