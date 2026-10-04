import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { SQLiteEventStore } from "../../event-store-sqlite/src/index.js";
import { listCanonicalizationCandidates } from "../src/canonicalization-candidate.js";
import {
  appendRepositoryChange,
  planRepositoryChange,
  planRepositoryChangeInRepository,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
} from "../src/repository-change-source.js";
import {
  processRepositoryKnowledgeJobs,
  REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION,
  requeueStalledRepositoryKnowledgeJobs,
  type RepositoryKnowledgeReviewSource,
  type RepositoryKnowledgeWorkerHost,
} from "../src/repository-knowledge-worker.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const projectId = "prj_0123456789abcdef";

async function queuedChange(
  options: {
    before?: string | null;
    path?: string;
    mutateManifest?: (manifest: Record<string, unknown>) => void;
  } = {},
) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-worker-"));
  roots.push(root);
  const path = options.path ?? "src/a.ts";
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), "export const a = 2;\n");
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
    projectId,
    sourceKind: "terminal_turn",
    sourceEventId: "evt_fedcba9876543210fedcba9876543210",
    before: {
      revision: digest("before"),
      files: options.before === null ? {} : { [path]: options.before ?? digest("x") },
    },
    after: { revision: digest("after"), files: { [path]: digest("export const a = 2;\n") } },
    occurredAt: "2026-09-25T09:00:00.000Z",
  })!;
  if (options.mutateManifest !== undefined) {
    const manifest = JSON.parse(planned.manifestContent) as Record<string, unknown>;
    options.mutateManifest(manifest);
    planned.manifestContent = JSON.stringify(manifest);
    planned.payload.sourceManifest = {
      contentHash: digest(planned.manifestContent),
      byteCount: Buffer.byteLength(planned.manifestContent),
    };
  }
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

/** A queued unit of newly created files planned through the shared intake policy. */
async function queuedFiles(files: Record<string, string>) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-intake-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), content);
  }
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: 3,
  });
  const cas = new Map<string, Uint8Array>();
  const artifacts = {
    has: async (uri: string) => cas.has(uri),
    get: async (uri: string) => cas.get(uri)!,
  };
  const planned = (await planRepositoryChangeInRepository({
    repositoryRoot: root,
    projectId,
    sourceKind: "terminal_turn",
    sourceEventId: "evt_fedcba9876543210fedcba9876543210",
    before: { revision: digest("before"), files: {} },
    after: {
      revision: digest("after"),
      files: Object.fromEntries(
        Object.entries(files).map(([path, content]) => [path, digest(content)]),
      ),
    },
    occurredAt: "2026-09-25T09:00:00.000Z",
  }))!;
  cas.set(
    `lervo-cas://sha256/${planned.payload.sourceManifest.contentHash.slice(7)}`,
    Buffer.from(planned.manifestContent),
  );
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

it("fences changes made during semantic review and lifecycle inspection", async () => {
  for (const phase of ["review", "inspectKnowledge"] as const) {
    const job = await queuedChange({ before: null });
    const reviewer = host("implementation_only");
    const original = reviewer[phase];
    reviewer[phase] = async () => {
      await writeFile(resolve(job.root, "src/a.ts"), "export const a = 3;\n");
      return (await original([], undefined as never)) as never;
    };
    try {
      const [outcome] = await processRepositoryKnowledgeJobs({
        repositoryRoot: job.root,
        events: job.events,
        artifacts: job.artifacts,
        workerId: "worker-a",
        host: reviewer,
      });
      expect(outcome).toMatchObject({
        terminalState: "stale",
        failureCode: "source_bytes_changed",
      });
      expect(resolved(job.events)[0]?.payload).toMatchObject({
        terminalState: "stale",
        knowledgeSnapshotHash: null,
      });
    } finally {
      job.events.close();
    }
  }
});

it("never records pending review without a real canonicalization candidate", async () => {
  const job = await queuedChange({ before: null, path: "docs/specs/demo.md" });
  try {
    const [outcome] = await processRepositoryKnowledgeJobs({
      repositoryRoot: job.root,
      events: job.events,
      artifacts: job.artifacts,
      workerId: "worker-a",
      host: host("canonical_change_candidate"),
    });
    expect(outcome).toMatchObject({
      terminalState: "attention_required",
      failureCode: "canonicalization_candidate_unavailable",
    });
    expect(resolved(job.events)[0]?.payload).toMatchObject({ canonicalizationCandidateId: null });
  } finally {
    job.events.close();
  }
});

it("rejects CAS manifests whose identity, count, digest, or paths disagree with the event", async () => {
  const mutations = [
    (manifest: Record<string, unknown>) => {
      manifest.projectId = "prj_wrong_project";
    },
    (manifest: Record<string, unknown>) => {
      manifest.sourceEventId = "evt_other";
    },
    (manifest: Record<string, unknown>) => {
      manifest.paths = [];
    },
    (manifest: Record<string, unknown>) => {
      (manifest.paths as { path: string }[])[0]!.path = "../outside.ts";
    },
    (manifest: Record<string, unknown>) => {
      (manifest.paths as { after: string }[])[0]!.after = "invalid";
    },
  ];
  for (const mutateManifest of mutations) {
    const job = await queuedChange({ before: null, mutateManifest });
    let calls = 0;
    try {
      const [outcome] = await processRepositoryKnowledgeJobs({
        repositoryRoot: job.root,
        events: job.events,
        artifacts: job.artifacts,
        workerId: "worker-a",
        host: {
          ...host("implementation_only"),
          review: async () => {
            calls++;
            return { classification: "implementation_only" };
          },
        },
      });
      expect(outcome).toMatchObject({
        terminalState: "attention_required",
        failureCode: "knowledge_job_source_invalid",
      });
      expect(calls).toBe(0);
    } finally {
      job.events.close();
    }
  }
});

it("rolls back the resolution event when another owner takes the expired lease", async () => {
  const job = await queuedChange({ before: null });
  let clock = Date.parse("2026-09-25T10:00:00.000Z");
  try {
    await expect(
      processRepositoryKnowledgeJobs({
        repositoryRoot: job.root,
        events: job.events,
        artifacts: job.artifacts,
        workerId: "worker-a",
        leaseDurationMs: 1_000,
        now: () => new Date(clock),
        host: {
          ...host("implementation_only"),
          review: async () => {
            clock += 2_000;
            job.events.claim({
              workerId: "worker-b",
              claimedAt: new Date(clock).toISOString(),
              leaseDurationMs: 60_000,
              destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
              limit: 1,
            });
            return { classification: "implementation_only" };
          },
        },
      }),
    ).rejects.toThrow(/lease/iu);
    expect(resolved(job.events)).toEqual([]);
    expect(job.events.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(1);
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

it("registers the canonicalization candidate that assigns a pending review's canonical write", async () => {
  const job = await queuedChange({ before: null });
  try {
    await processRepositoryKnowledgeJobs({
      repositoryRoot: job.root,
      events: job.events,
      artifacts: job.artifacts,
      workerId: "worker-a",
      host: host("canonical_change_candidate"),
    });
    const payload = resolved(job.events)[0]?.payload as { canonicalizationCandidateId: string };
    expect(payload).toMatchObject({ terminalState: "pending_review" });
    const [candidate] = await listCanonicalizationCandidates(job.root);
    expect(candidate).toMatchObject({
      candidateId: payload.canonicalizationCandidateId,
      observedState: "candidate",
      sourceBindings: [
        {
          path: "src/a.ts",
          beforeHash: null,
          afterHash: digest("export const a = 2;\n"),
          responsibility: "architecture_or_specification",
        },
      ],
    });
    await writeFile(resolve(job.root, "src/a.ts"), "export const a = 3;\n");
    expect((await listCanonicalizationCandidates(job.root))[0]?.observedState).toBe("stale");
  } finally {
    job.events.close();
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

it("skips generated and oversize files while the remaining files reach current", async () => {
  const job = await queuedFiles({
    "src/a.ts": "export const a = 2;\n",
    "docs/large.md": "x".repeat(256 * 1024 + 1),
    "apps/cli/release-sbom.cdx.json": "{}\n",
    ".changes/relint_a.yaml": "bump: patch\n",
  });
  const reviewed: string[][] = [];
  try {
    const [outcome] = await processRepositoryKnowledgeJobs({
      repositoryRoot: job.root,
      events: job.events,
      artifacts: job.artifacts,
      workerId: "worker-a",
      host: {
        ...host("implementation_only"),
        review: async (sources: RepositoryKnowledgeReviewSource[]) => {
          reviewed.push(sources.map((source) => source.path));
          return { classification: "implementation_only" };
        },
      },
    });
    expect(outcome).toMatchObject({ terminalState: "current", failureCode: null });
    expect(reviewed).toEqual([["src/a.ts"]]);
    expect(resolved(job.events)[0]?.payload).toMatchObject({
      terminalState: "current",
      skippedPathCount: 3,
      skippedReasons: ["skipped_generated", "skipped_oversize"],
      subJobIndex: null,
      subJobCount: 1,
    });
  } finally {
    job.events.close();
  }
});

it("never claims currency when only unreviewable files changed", async () => {
  const job = await queuedFiles({ "docs/large.md": "x".repeat(256 * 1024 + 1) });
  try {
    const [outcome] = await processRepositoryKnowledgeJobs({
      repositoryRoot: job.root,
      events: job.events,
      artifacts: job.artifacts,
      workerId: "worker-a",
      host: host("implementation_only"),
    });
    expect(outcome).toMatchObject({
      terminalState: "attention_required",
      failureCode: "review_sources_unreviewable",
    });
    expect(resolved(job.events)[0]?.payload).toMatchObject({
      skippedPathCount: 1,
      skippedReasons: ["skipped_oversize"],
      subJobCount: 0,
    });
  } finally {
    job.events.close();
  }
});

it("reviews more than 64 paths in ordered sub-jobs that settle together", async () => {
  const files = Object.fromEntries(
    Array.from({ length: 70 }, (_, index) => [
      `src/f${String(index).padStart(2, "0")}.ts`,
      `export const f${index} = ${index};\n`,
    ]),
  );
  const current = await queuedFiles(files);
  const reviewed: number[] = [];
  try {
    const [outcome] = await processRepositoryKnowledgeJobs({
      repositoryRoot: current.root,
      events: current.events,
      artifacts: current.artifacts,
      workerId: "worker-a",
      host: {
        ...host("implementation_only"),
        review: async (sources: RepositoryKnowledgeReviewSource[]) => {
          reviewed.push(sources.length);
          return { classification: "implementation_only" };
        },
      },
    });
    expect(outcome).toMatchObject({ terminalState: "current" });
    expect(reviewed).toEqual([64, 6]);
    expect(resolved(current.events)).toHaveLength(1);
    expect(resolved(current.events)[0]?.payload).toMatchObject({ subJobCount: 2 });
  } finally {
    current.events.close();
  }
  const attention = await queuedFiles(files);
  let call = 0;
  try {
    const [outcome] = await processRepositoryKnowledgeJobs({
      repositoryRoot: attention.root,
      events: attention.events,
      artifacts: attention.artifacts,
      workerId: "worker-a",
      host: {
        ...host("implementation_only"),
        review: async () => ({
          classification: call++ === 0 ? "implementation_only" : "needs_review",
        }),
      },
    });
    expect(outcome).toMatchObject({
      terminalState: "attention_required",
      failureCode: "review_needs_attention",
    });
    expect(resolved(attention.events)[0]?.payload).toMatchObject({
      subJobIndex: 1,
      subJobCount: 2,
    });
  } finally {
    attention.events.close();
  }
});

it("re-queues a job rejected whole at intake exactly once", async () => {
  const job = await queuedFiles({ "src/a.ts": "export const a = 2;\n" });
  const changeEventId = "evt_0123456789abcdef0123456789abcdef";
  try {
    // A pre-ADR-0457 worker settled the unit as a whole-job intake rejection.
    job.events.transact((transaction) => {
      const [delivery] = transaction.claim({
        workerId: "legacy",
        claimedAt: "2026-09-25T09:01:00.000Z",
        leaseDurationMs: 60_000,
        destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
        limit: 1,
      });
      transaction.append({
        eventId: "evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        projectId,
        runId: delivery!.event.runId,
        sessionId: delivery!.event.sessionId,
        occurredAt: "2026-09-25T09:01:00.000Z",
        actor: { kind: "system" },
        schemaVersion: 3,
        policyVersion: digest("policy"),
        type: "repository.knowledge.resolved",
        payload: {
          changeEventId,
          changeEventHash: delivery!.event.eventHash,
          sourceKind: "terminal_turn",
          terminalState: "attention_required",
          classification: null,
          attemptCount: 1,
          failureCode: "review_source_limit_exceeded",
          knowledgeSnapshotHash: null,
          canonicalizationCandidateId: null,
          resolvedAt: "2026-09-25T09:01:00.000Z",
        },
      });
      transaction.acknowledge({
        eventId: changeEventId,
        destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
        workerId: "legacy",
        acknowledgedAt: "2026-09-25T09:01:00.000Z",
      });
    });
    expect(
      await requeueStalledRepositoryKnowledgeJobs({
        repositoryRoot: job.root,
        events: job.events,
      }),
    ).toEqual({ requeued: 1, deferred: 0 });
    expect(
      job.events.getOutbox(changeEventId, REPOSITORY_KNOWLEDGE_REQUEUE_DESTINATION),
    ).toMatchObject({ status: "pending" });
    const [outcome] = await processRepositoryKnowledgeJobs({
      repositoryRoot: job.root,
      events: job.events,
      artifacts: job.artifacts,
      workerId: "worker-a",
      host: host("implementation_only"),
    });
    expect(outcome).toMatchObject({ changeEventId, terminalState: "current" });
    const [original, successor] = resolved(job.events);
    expect(successor?.eventId).not.toBe(original?.eventId);
    expect(successor?.payload).toMatchObject({
      changeEventId,
      terminalState: "current",
      supersedesResolutionEventId: expect.stringMatching(/^evt_[a-f0-9]{32}$/u),
    });
    // The successor resolution closes the change; neither a cursor loss nor a rerun re-queues it.
    await rm(resolve(job.root, ".lervo/state"), { recursive: true, force: true });
    expect(
      await requeueStalledRepositoryKnowledgeJobs({
        repositoryRoot: job.root,
        events: job.events,
      }),
    ).toEqual({ requeued: 0, deferred: 0 });
  } finally {
    job.events.close();
  }
});
