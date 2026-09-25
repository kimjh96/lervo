import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { SQLiteEventStore } from "../../event-store-sqlite/src/index.js";
import {
  appendRepositoryChange,
  planRepositoryChange,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
} from "../src/repository-change-source.js";
import {
  processRepositoryKnowledgeJobs,
  type RepositoryKnowledgeWorkerHost,
} from "../src/repository-knowledge-worker.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const projectId = "prj_0123456789abcdef";

async function queuedChange(options: { before?: string | null } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-worker-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/a.ts"), "export const a = 2;\n");
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: 3,
  });
  const cas = new Map<string, Uint8Array>();
  const artifacts = {
    has: async (uri: string) => cas.has(uri),
    get: async (uri: string) => cas.get(uri)!,
    put: async (content: string) => {
      const contentHash = digest(content);
      cas.set(`lervo-cas://sha256/${contentHash.slice(7)}`, Buffer.from(content));
      return { contentHash };
    },
  };
  const planned = planRepositoryChange({
    sourceKind: "terminal_turn",
    sourceEventId: "evt_fedcba9876543210fedcba9876543210",
    before: {
      revision: digest("before"),
      files: options.before === null ? {} : { "src/a.ts": options.before ?? digest("x") },
    },
    after: { revision: digest("after"), files: { "src/a.ts": digest("export const a = 2;\n") } },
    occurredAt: "2026-09-25T09:00:00.000Z",
  })!;
  await artifacts.put(planned.manifestContent);
  events.transact((transaction) =>
    appendRepositoryChange(
      transaction,
      {
        eventId: "evt_0123456789abcdef0123456789abcdef",
        projectId,
        runId: "run_0123456789abcdef0123456789abcdef",
        sessionId: "ses_0123456789abcdef0123456789abcdef",
        occurredAt: "2026-09-25T09:00:00.000Z",
        actor: { kind: "system" },
        policyVersion: digest("policy"),
      },
      planned,
    ),
  );
  return { root, events, artifacts: artifacts as never };
}

function host(
  classification: "implementation_only" | "canonical_change_candidate" | "needs_review",
  current = true,
): RepositoryKnowledgeWorkerHost {
  return {
    review: async () => ({ classification }),
    inspectKnowledge: async () => ({ current, snapshotHash: digest("snapshot") }),
  };
}

function resolved(events: SQLiteEventStore) {
  return events
    .list({ limit: 100 })
    .filter((event) => event.type === "repository.knowledge.resolved");
}

it("settles a newly created implementation-only file as current with its knowledge snapshot", async () => {
  const job = await queuedChange({ before: null });
  try {
    const outcomes = await processRepositoryKnowledgeJobs({
      repositoryRoot: job.root,
      events: job.events,
      artifacts: job.artifacts,
      workerId: "worker-a",
      host: host("implementation_only"),
    });
    expect(outcomes).toEqual([
      {
        changeEventId: "evt_0123456789abcdef0123456789abcdef",
        terminalState: "current",
        failureCode: null,
      },
    ]);
    expect(resolved(job.events)[0]?.payload).toMatchObject({
      terminalState: "current",
      classification: "implementation_only",
      knowledgeSnapshotHash: digest("snapshot"),
    });
    expect(job.events.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(0);
  } finally {
    job.events.close();
  }
});

it("never claims currency for drifted source, candidates, or unavailable former bytes", async () => {
  const cases = [
    {
      setup: { before: null },
      host: host("canonical_change_candidate"),
      state: "pending_review",
      code: null,
    },
    {
      setup: {},
      host: host("implementation_only"),
      state: "attention_required",
      code: "before_bytes_unavailable",
    },
    {
      setup: { before: null },
      host: host("implementation_only", false),
      state: "attention_required",
      code: "knowledge_lifecycle_pending",
    },
    {
      setup: { before: null },
      host: host("needs_review"),
      state: "attention_required",
      code: "review_needs_attention",
    },
  ] as const;
  for (const item of cases) {
    const job = await queuedChange(item.setup);
    try {
      const [outcome] = await processRepositoryKnowledgeJobs({
        repositoryRoot: job.root,
        events: job.events,
        artifacts: job.artifacts,
        workerId: "worker-a",
        host: item.host,
      });
      expect(outcome).toMatchObject({ terminalState: item.state, failureCode: item.code });
    } finally {
      job.events.close();
    }
  }
  const drifted = await queuedChange({ before: null });
  try {
    await writeFile(resolve(drifted.root, "src/a.ts"), "export const a = 3;\n");
    const [outcome] = await processRepositoryKnowledgeJobs({
      repositoryRoot: drifted.root,
      events: drifted.events,
      artifacts: drifted.artifacts,
      workerId: "worker-a",
      host: host("implementation_only"),
    });
    expect(outcome).toMatchObject({ terminalState: "stale", failureCode: "source_bytes_changed" });
  } finally {
    drifted.events.close();
  }
});

it("reschedules a transient review failure and settles exhaustion on the sixteenth attempt", async () => {
  const job = await queuedChange({ before: null });
  let clock = Date.parse("2026-09-25T10:00:00.000Z");
  const failing: RepositoryKnowledgeWorkerHost = {
    review: async () => {
      throw new Error("provider unavailable");
    },
    inspectKnowledge: async () => ({ current: true, snapshotHash: digest("snapshot") }),
  };
  try {
    const states: string[] = [];
    for (let attempt = 1; attempt <= 16; attempt++) {
      const [outcome] = await processRepositoryKnowledgeJobs({
        repositoryRoot: job.root,
        events: job.events,
        artifacts: job.artifacts,
        workerId: "worker-a",
        host: failing,
        now: () => new Date(clock),
        maximumJobs: 1,
      });
      states.push(outcome!.terminalState);
      clock += 2 * 60 * 60_000;
    }
    expect(states.slice(0, 15).every((state) => state === "retry_scheduled")).toBe(true);
    expect(states[15]).toBe("attention_required");
    expect(resolved(job.events)[0]?.payload).toMatchObject({
      failureCode: "knowledge_retry_exhausted",
      attemptCount: 16,
    });
  } finally {
    job.events.close();
  }
});
