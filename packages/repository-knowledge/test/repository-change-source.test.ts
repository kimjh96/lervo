import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { SQLiteEventStore } from "../../event-store-sqlite/src/index.js";
import {
  appendRepositoryChange,
  planRepositoryChange,
  planRepositoryChangeInRepository,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
} from "../src/repository-change-source.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = (fill: string) => `sha256:${fill.repeat(64)}`;
const draft = {
  eventId: "evt_0123456789abcdef0123456789abcdef",
  projectId: "prj_0123456789abcdef",
  runId: "run_0123456789abcdef0123456789abcdef",
  sessionId: "ses_0123456789abcdef0123456789abcdef",
  occurredAt: "2026-09-25T09:00:00.000Z",
  actor: { kind: "system" as const },
  policyVersion: hash("a"),
};

async function openStore() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-change-source-"));
  roots.push(root);
  return SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId: draft.projectId,
    writableEventSchemaVersion: 3,
  });
}

function plan(after: Record<string, string>) {
  return planRepositoryChange({
    sourceKind: "terminal_turn",
    sourceEventId: "evt_fedcba9876543210fedcba9876543210",
    before: { revision: hash("b"), files: { "docs/a.md": hash("1"), "src/b.ts": hash("2") } },
    after: { revision: hash("c"), files: after },
    occurredAt: draft.occurredAt,
  });
}

it("records one change event and one knowledge job in a single transaction", async () => {
  const planned = plan({ "docs/a.md": hash("9"), "src/c.ts": hash("3") })!;
  expect(planned.payload.changedPaths).toEqual(["docs/a.md", "src/b.ts", "src/c.ts"]);
  expect(JSON.parse(planned.manifestContent).paths[1]).toEqual({
    path: "src/b.ts",
    before: hash("2"),
    after: null,
  });
  const store = await openStore();
  try {
    const result = store.transact((transaction) =>
      appendRepositoryChange(transaction, draft, planned),
    );
    expect(result).toEqual({ eventId: draft.eventId, enqueued: true });
    expect(store.get(draft.eventId)?.type).toBe("repository.change.completed");
    expect(store.getOutbox(draft.eventId, REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)?.status).toBe(
      "pending",
    );
    // A replay of the same unit is idempotent and never creates a second job.
    expect(
      store.transact((transaction) => appendRepositoryChange(transaction, draft, planned)),
    ).toEqual({ eventId: draft.eventId, enqueued: false });
    expect(store.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(1);
  } finally {
    store.close();
  }
});

it("records nothing for an unchanged unit", () => {
  expect(plan({ "docs/a.md": hash("1"), "src/b.ts": hash("2") })).toBeNull();
});

it("publishes only the count beyond the path bound while the manifest keeps every path", async () => {
  const files = Object.fromEntries(
    Array.from({ length: 70 }, (_, index) => [`src/f${index}.ts`, hash("4")]),
  );
  const planned = plan(files)!;
  expect(planned.payload.changedPathCount).toBe(72);
  expect(planned.payload.changedPaths).toEqual([]);
  expect(JSON.parse(planned.manifestContent).paths).toHaveLength(72);
  const store = await openStore();
  try {
    store.transact((transaction) => appendRepositoryChange(transaction, draft, planned));
    expect(store.get(draft.eventId)?.payload.changedPathCount).toBe(72);
  } finally {
    store.close();
  }
});

it("drops Git-ignored build outputs but keeps every path outside Git", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-change-ignore-"));
  roots.push(root);
  const input = {
    repositoryRoot: root,
    sourceKind: "terminal_turn" as const,
    sourceEventId: "evt_fedcba9876543210fedcba9876543210",
    before: { revision: hash("1"), files: { "src/a.ts": hash("2") } },
    after: {
      revision: hash("3"),
      files: { "src/a.ts": hash("4"), "pkg/tsconfig.tsbuildinfo": hash("5") },
    },
    occurredAt: "2026-09-25T09:00:00.000Z",
  };
  expect((await planRepositoryChangeInRepository(input))?.payload.changedPaths).toEqual([
    "pkg/tsconfig.tsbuildinfo",
    "src/a.ts",
  ]);
  execFileSync("git", ["init", "-q"], { cwd: root });
  await writeFile(resolve(root, ".gitignore"), "*.tsbuildinfo\n");
  expect((await planRepositoryChangeInRepository(input))?.payload.changedPaths).toEqual([
    "src/a.ts",
  ]);
});
