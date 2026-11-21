import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { SQLiteEventStore } from "../../event-store-sqlite/src/index.js";
import {
  appendRepositoryChange,
  planRepositoryChange,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
} from "../src/repository-change-source.js";
import { retireRepositoryKnowledgeJobs } from "../src/repository-knowledge-job-admission.js";
import { requeueStalledRepositoryKnowledgeJobs } from "../src/repository-knowledge-requeue.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = (fill: string) => `sha256:${fill.repeat(64)}`;

it("settles every held job once as an auditable stale resolution that requeue leaves alone (ADR-0605)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-job-retire-"));
  roots.push(root);
  const store = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId: "prj_0123456789abcdef",
    writableEventSchemaVersion: 3,
  });
  try {
    // Jobs a host enqueued before it lost ownership, or under an earlier release.
    for (let index = 0; index < 5; index++) {
      const planned = planRepositoryChange({
        sourceKind: "terminal_turn",
        sourceEventId: `evt_${String(index).repeat(32)}`,
        before: { revision: hash("b"), files: { "docs/a.md": hash("1") } },
        after: { revision: hash("c"), files: { "docs/a.md": hash(String(index + 2)) } },
        occurredAt: "2026-10-17T17:22:00.000Z",
      })!;
      store.transact((transaction) =>
        appendRepositoryChange(
          transaction,
          {
            eventId: `evt_${"f".repeat(31)}${index}`,
            projectId: "prj_0123456789abcdef",
            runId: `run_${"0".repeat(32)}`,
            sessionId: `ses_${"0".repeat(32)}`,
            occurredAt: "2026-10-17T17:22:00.000Z",
            actor: { kind: "system" },
            policyVersion: hash("a"),
          },
          planned,
          { admitted: true },
        ),
      );
    }
    expect(store.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(5);
    const now = () => new Date("2026-11-21T08:00:00.000Z");
    expect(
      retireRepositoryKnowledgeJobs({
        events: store,
        workerId: "retire-test",
        reason: "convergence_owner_elsewhere",
        now,
      }),
    ).toBe(5);
    expect(store.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(0);
    const resolved = store
      .list({ limit: 100 })
      .filter((event) => event.type === "repository.knowledge.resolved");
    expect(resolved).toHaveLength(5);
    expect(resolved.every((event) => event.payload.terminalState === "stale")).toBe(true);
    expect(
      resolved.every((event) => event.payload.failureCode === "convergence_owner_elsewhere"),
    ).toBe(true);
    // A stale settlement is final: nothing puts it back in the queue.
    await expect(
      requeueStalledRepositoryKnowledgeJobs({ repositoryRoot: root, events: store, now }),
    ).resolves.toMatchObject({ requeued: 0 });
    expect(store.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(0);
    // Nothing left to retire.
    expect(
      retireRepositoryKnowledgeJobs({ events: store, workerId: "retire-test", reason: "x", now }),
    ).toBe(0);
  } finally {
    store.close();
  }
});
