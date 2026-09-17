import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  QueuedConversationDeliberationBackend,
  runConversationDeliberationWorkerCycle,
} from "@lervo/conversation-control";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConversationDeliberationSQLiteError,
  SQLiteConversationDeliberationJobStore,
} from "../src/index.js";

const roots: string[] = [];
const databaseName = "deliberations.sqlite";
const sourceEventId = `cve_${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function open() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-deliberation-"));
  roots.push(root);
  const path = resolve(root, databaseName);
  return { path, store: await SQLiteConversationDeliberationJobStore.open({ path }) };
}

function request(
  overrides: Partial<Parameters<QueuedConversationDeliberationBackend["start"]>[0]> = {},
) {
  return {
    projectId: "prj_deliberation01",
    principalId: "operator:reviewer",
    sourceEventId,
    conversationId: "cnv_deliberation01",
    threadId: "thd_deliberation01",
    requesterParticipantId: "ptc_requester01",
    policyId: "deliberation_product-review",
    topic: "Review the deployment structure.",
    requestedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("durable conversation deliberation queue", () => {
  it("schedules queued work and lease expiry without claiming it", async () => {
    const { store } = await open();
    try {
      expect(store.nextWakeupAt()).toBeNull();
      await new QueuedConversationDeliberationBackend(store).start(request());
      expect(store.nextWakeupAt()).toBe(Date.parse(request().requestedAt));
      await store.claim({
        workerId: "fixture",
        claimedAt: "2026-08-22T00:01:00.000Z",
        leaseDurationMs: 10_000,
      });
      expect(store.nextWakeupAt()).toBe(Date.parse("2026-08-22T00:01:10.000Z"));
    } finally {
      store.close();
    }
  });

  it("rejects an origin binding digest that does not match its Lervo coordinates", async () => {
    const { store } = await open();
    await expect(
      store.enqueue({
        projectId: "prj_deliberation01",
        sourceEventId,
        deliberationId: "dlb_deliberation01",
        requestHash: `sha256:${"1".repeat(64)}`,
        principalHash: `sha256:${"2".repeat(64)}`,
        origin: {
          conversationId: "cnv_deliberation01",
          threadId: "thd_deliberation01",
          requesterParticipantId: "ptc_requester01",
          originBindingDigest: `sha256:${"f".repeat(64)}`,
        },
        policyId: "deliberation_product-review",
        topic: "Review the deployment structure.",
        requestedAt: "2026-08-22T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "integrity_failed" });
    store.close();
  });

  it("returns one durable job for repeated source events and settles it after restart", async () => {
    const { path, store } = await open();
    let current = store;
    const firstBackend = new QueuedConversationDeliberationBackend(current);
    const first = await firstBackend.start(request());
    const duplicate = await firstBackend.start(
      request({
        requestedAt: "2026-08-22T00:00:01.000Z",
      }),
    );

    expect(duplicate).toEqual(first);
    expect(first).toMatchObject({ status: "running", nextAction: "wait" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    current.close();

    current = await SQLiteConversationDeliberationJobStore.open({ path });
    const execute = vi.fn(async (job: { deliberationId: string }) => ({
      deliberationId: job.deliberationId,
      status: "converged" as const,
      artifactCount: 7,
      nextAction: "none" as const,
    }));
    const cycle = await runConversationDeliberationWorkerCycle({
      store: current,
      executor: { execute },
      workerId: "conversation-worker-1",
      now: () => new Date("2026-08-22T00:01:00.000Z"),
    });

    expect(cycle.status).toBe("settled");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      principalHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      origin: {
        conversationId: "cnv_deliberation01",
        threadId: "thd_deliberation01",
        requesterParticipantId: "ptc_requester01",
        originBindingDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(execute.mock.calls[0]?.[0]).not.toHaveProperty("principalId");
    const notification = await current.claimNotification({
      workerId: "notification-worker",
      claimedAt: "2026-08-22T00:01:01.000Z",
      leaseDurationMs: 10_000,
    });
    expect(notification).toMatchObject({
      notification: {
        operation: "start",
        projectId: "prj_deliberation01",
        deliberationId: first.deliberationId,
        summary: { status: "converged", artifactCount: 7 },
        occurredAt: "2026-08-22T00:01:00.000Z",
        state: "leased",
        attemptCount: 1,
      },
    });
    await current.acceptNotification({
      deliberationId: first.deliberationId,
      leaseId: notification!.leaseId,
      conversationEventId: `cve_${"b".repeat(64)}`,
      acceptedAt: "2026-08-22T00:01:02.000Z",
    });
    await expect(
      current.claimNotification({
        workerId: "notification-worker",
        claimedAt: "2026-08-22T00:01:20.000Z",
        leaseDurationMs: 10_000,
      }),
    ).resolves.toBeNull();
    await expect(
      new QueuedConversationDeliberationBackend(current).inspect({
        projectId: "prj_deliberation01",
        principalId: "operator:reader",
        deliberationId: first.deliberationId,
        inspectedAt: "2026-08-22T00:02:00.000Z",
      }),
    ).resolves.toEqual({
      deliberationId: first.deliberationId,
      status: "converged",
      artifactCount: 7,
      nextAction: "none",
    });
    current.close();

    const database = new DatabaseSync(path);
    const row = database
      .prepare(
        `
      SELECT principal_hash, topic, origin_conversation_id, origin_thread_id,
        origin_requester_participant_id, origin_binding_digest
      FROM conversation_deliberation_jobs
      WHERE deliberation_id = ?
    `,
      )
      .get(first.deliberationId);
    expect(row?.principal_hash).not.toBe("operator:reviewer");
    expect(row?.topic).toBe("Review the deployment structure.");
    expect(row).toMatchObject({
      origin_conversation_id: "cnv_deliberation01",
      origin_thread_id: "thd_deliberation01",
      origin_requester_participant_id: "ptc_requester01",
      origin_binding_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(() =>
      database
        .prepare("DELETE FROM conversation_deliberation_jobs WHERE deliberation_id = ?")
        .run(first.deliberationId),
    ).toThrow("cannot be deleted");
    expect(() =>
      database
        .prepare("DELETE FROM conversation_deliberation_notifications WHERE deliberation_id = ?")
        .run(first.deliberationId),
    ).toThrow("cannot be deleted");
    database.close();
  });

  it("rejects a different request that reuses the same project source event", async () => {
    const { store } = await open();
    const backend = new QueuedConversationDeliberationBackend(store);
    await backend.start(request());

    await expect(backend.start(request({ topic: "A different topic." }))).rejects.toMatchObject({
      name: "ConversationDeliberationSQLiteError",
      code: "deliberation_request_conflict",
    } satisfies Partial<ConversationDeliberationSQLiteError>);
    store.close();
  });

  it("does not execute an expired lease again when its external effect is unknown", async () => {
    const { path, store } = await open();
    let current = store;
    const backend = new QueuedConversationDeliberationBackend(current);
    const started = await backend.start(request());
    const lease = await current.claim({
      workerId: "worker-that-stopped",
      claimedAt: "2026-08-22T00:01:00.000Z",
      leaseDurationMs: 10_000,
    });
    expect(lease?.job.deliberationId).toBe(started.deliberationId);
    await current.renew({
      deliberationId: started.deliberationId,
      leaseId: lease!.leaseId,
      renewedAt: "2026-08-22T00:01:05.000Z",
      leaseDurationMs: 10_000,
    });
    current.close();

    current = await SQLiteConversationDeliberationJobStore.open({ path });
    const execute = vi.fn();
    await expect(
      runConversationDeliberationWorkerCycle({
        store: current,
        executor: { execute },
        workerId: "replacement-worker",
        now: () => new Date("2026-08-22T00:01:12.000Z"),
      }),
    ).resolves.toEqual({ status: "idle" });
    await expect(
      new QueuedConversationDeliberationBackend(current).inspect({
        projectId: "prj_deliberation01",
        principalId: "operator:reader",
        deliberationId: started.deliberationId,
        inspectedAt: "2026-08-22T00:01:12.000Z",
      }),
    ).resolves.toMatchObject({ status: "running", nextAction: "wait" });
    await expect(
      runConversationDeliberationWorkerCycle({
        store: current,
        executor: { execute },
        workerId: "replacement-worker",
        now: () => new Date("2026-08-22T00:01:16.000Z"),
      }),
    ).resolves.toEqual({ status: "idle" });
    expect(execute).not.toHaveBeenCalled();
    await expect(
      new QueuedConversationDeliberationBackend(current).inspect({
        projectId: "prj_deliberation01",
        principalId: "operator:reader",
        deliberationId: started.deliberationId,
        inspectedAt: "2026-08-22T00:01:16.000Z",
      }),
    ).resolves.toMatchObject({ status: "unknown", nextAction: "none" });
    current.close();
  });

  it("records an executor exception as uncertain instead of retrying it", async () => {
    const { store } = await open();
    const backend = new QueuedConversationDeliberationBackend(store);
    const started = await backend.start(request());
    const execute = vi.fn(async () => {
      throw new Error("provider detail must not escape");
    });
    await expect(
      runConversationDeliberationWorkerCycle({
        store,
        executor: { execute },
        workerId: "conversation-worker-1",
        now: () => new Date("2026-08-22T00:01:00.000Z"),
      }),
    ).resolves.toEqual({
      status: "uncertain",
      deliberationId: started.deliberationId,
      failureCode: "deliberation_execution_uncertain",
      uncertainAt: "2026-08-22T00:01:00.000Z",
    });
    await expect(
      store.listUncertain({ projectId: "prj_deliberation01", limit: 10 }),
    ).resolves.toEqual([
      {
        deliberationId: started.deliberationId,
        uncertainAt: "2026-08-22T00:01:00.000Z",
      },
    ]);
    await expect(
      runConversationDeliberationWorkerCycle({
        store,
        executor: { execute },
        workerId: "conversation-worker-1",
        now: () => new Date("2026-08-22T00:02:00.000Z"),
      }),
    ).resolves.toEqual({ status: "idle" });
    expect(execute).toHaveBeenCalledOnce();
    store.close();
  });

  it("reclaims the same terminal notification after restart without recreating its identity", async () => {
    const { path, store } = await open();
    let current = store;
    const started = await new QueuedConversationDeliberationBackend(current).start(request());
    await runConversationDeliberationWorkerCycle({
      store: current,
      executor: {
        execute: async () => ({
          deliberationId: started.deliberationId,
          status: "failed",
          artifactCount: 1,
          nextAction: "none",
        }),
      },
      workerId: "conversation-worker-1",
      now: () => new Date("2026-08-22T00:01:00.000Z"),
    });
    current.close();

    current = await SQLiteConversationDeliberationJobStore.open({ path });
    const first = await current.claimNotification({
      workerId: "notification-worker-1",
      claimedAt: "2026-08-22T00:01:01.000Z",
      leaseDurationMs: 10_000,
    });
    expect(first?.notification).toMatchObject({
      deliberationId: started.deliberationId,
      occurredAt: "2026-08-22T00:01:00.000Z",
      attemptCount: 1,
    });
    current.close();

    current = await SQLiteConversationDeliberationJobStore.open({ path });
    await expect(
      current.claimNotification({
        workerId: "notification-worker-2",
        claimedAt: "2026-08-22T00:01:10.000Z",
        leaseDurationMs: 10_000,
      }),
    ).resolves.toBeNull();
    const reclaimed = await current.claimNotification({
      workerId: "notification-worker-2",
      claimedAt: "2026-08-22T00:01:12.000Z",
      leaseDurationMs: 10_000,
    });
    expect(reclaimed?.notification).toMatchObject({
      deliberationId: started.deliberationId,
      occurredAt: "2026-08-22T00:01:00.000Z",
      attemptCount: 2,
    });
    await current.acceptNotification({
      deliberationId: started.deliberationId,
      leaseId: reclaimed!.leaseId,
      conversationEventId: `cve_${"f".repeat(64)}`,
      acceptedAt: "2026-08-22T00:01:13.000Z",
    });
    current.close();
  });

  it.each([
    { status: "running" as const, nextAction: "wait" as const },
    { status: "unknown" as const, nextAction: "none" as const },
    { status: "interrupted" as const, nextAction: "resume" as const },
  ])("does not settle a non-terminal worker result: $status", async ({ status, nextAction }) => {
    const { store } = await open();
    const backend = new QueuedConversationDeliberationBackend(store);
    const started = await backend.start(request());
    await expect(
      runConversationDeliberationWorkerCycle({
        store,
        executor: {
          execute: async () => ({
            deliberationId: started.deliberationId,
            status,
            artifactCount: 1,
            nextAction,
          }),
        },
        workerId: "conversation-worker-1",
        now: () => new Date("2026-08-22T00:01:00.000Z"),
      }),
    ).resolves.toMatchObject({ status: "uncertain" });
    await expect(
      backend.inspect({
        projectId: "prj_deliberation01",
        principalId: "operator:reader",
        deliberationId: started.deliberationId,
        inspectedAt: "2026-08-22T00:02:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "unknown", nextAction: "none" });
    store.close();
  });
});
