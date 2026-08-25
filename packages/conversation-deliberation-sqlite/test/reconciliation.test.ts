import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  QueuedConversationDeliberationBackend,
  reconcileConversationDeliberation,
} from "@lervo/conversation-control";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SQLiteConversationDeliberationJobStore } from "../src/index.js";

const roots: string[] = [];
const sourceEventId = `cve_${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function open(prefix = "lervo-conversation-deliberation-reconcile-") {
  const root = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(root);
  const path = resolve(root, "deliberations.sqlite");
  return { path, store: await SQLiteConversationDeliberationJobStore.open({ path }) };
}

async function uncertain(store: SQLiteConversationDeliberationJobStore) {
  const backend = new QueuedConversationDeliberationBackend(store);
  const started = await backend.start({
    projectId: "prj_deliberation01",
    principalId: "operator:reviewer",
    sourceEventId,
    policyId: "deliberation_product-review",
    topic: "Review the deployment structure.",
    requestedAt: "2026-08-22T00:00:00.000Z",
  });
  const lease = await store.claim({
    workerId: "conversation-worker-1",
    claimedAt: "2026-08-22T00:01:00.000Z",
    leaseDurationMs: 10_000,
  });
  if (lease === null) throw new Error("The deliberation queue lease is missing.");
  await store.markUncertain({
    deliberationId: started.deliberationId,
    leaseId: lease.leaseId,
    failedAt: "2026-08-22T00:01:01.000Z",
    failureCode: "deliberation_execution_uncertain",
  });
  return started;
}

describe("conversation deliberation reconciliation storage", () => {
  it("repairs only an uncertain queue summary confirmed by an authoritative inspection", async () => {
    const { store } = await open();
    const started = await uncertain(store);
    const inspect = vi.fn(async () => ({
      status: "confirmed" as const,
      sourceKind: "fixture_project_inspection_v1",
      evidenceHash: `sha256:${"b".repeat(64)}`,
      summary: {
        deliberationId: started.deliberationId,
        status: "converged" as const,
        artifactCount: 5,
        nextAction: "none" as const,
      },
    }));

    await expect(
      reconcileConversationDeliberation({
        store,
        source: { inspect },
        projectId: "prj_deliberation01",
        deliberationId: started.deliberationId,
        now: () => new Date("2026-08-22T00:02:00.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "reconciled",
      summary: { status: "converged", artifactCount: 5 },
    });
    const repaired = await store.inspect({
      projectId: "prj_deliberation01",
      deliberationId: started.deliberationId,
    });
    expect(repaired).toMatchObject({
      state: "settled",
      failureCode: null,
      reconciliation: {
        sourceKind: "fixture_project_inspection_v1",
        evidenceHash: `sha256:${"b".repeat(64)}`,
        priorFailureCode: "deliberation_execution_uncertain",
        uncertainAt: "2026-08-22T00:01:01.000Z",
        reconciledAt: "2026-08-22T00:02:00.000Z",
      },
    });
    await expect(
      store.reconcile({
        projectId: "prj_deliberation01",
        deliberationId: started.deliberationId,
        requestHash: repaired!.requestHash,
        sourceKind: "another_project_inspection_v1",
        evidenceHash: `sha256:${"c".repeat(64)}`,
        reconciledAt: "2026-08-22T00:02:01.000Z",
        summary: repaired!.summary!,
      }),
    ).resolves.toBeUndefined();
    await expect(
      reconcileConversationDeliberation({
        store,
        source: { inspect },
        projectId: "prj_deliberation01",
        deliberationId: started.deliberationId,
      }),
    ).resolves.toMatchObject({ status: "not_uncertain" });
    expect(inspect).toHaveBeenCalledOnce();
    store.close();
  });

  it("keeps active or incomplete authoritative history uncertain", async () => {
    const { store } = await open();
    const started = await uncertain(store);
    await expect(
      reconcileConversationDeliberation({
        store,
        source: {
          inspect: async () => ({ status: "not_confirmed", reason: "active_execution" }),
        },
        projectId: "prj_deliberation01",
        deliberationId: started.deliberationId,
        now: () => new Date("2026-08-22T00:02:00.000Z"),
      }),
    ).resolves.toEqual({ status: "not_confirmed", reason: "active_execution" });
    await expect(
      reconcileConversationDeliberation({
        store,
        source: {
          inspect: async () => ({
            status: "confirmed",
            sourceKind: "fixture_project_inspection_v1",
            evidenceHash: `sha256:${"d".repeat(64)}`,
            summary: {
              deliberationId: started.deliberationId,
              status: "unknown",
              artifactCount: 0,
              nextAction: "none",
            },
          }),
        },
        projectId: "prj_deliberation01",
        deliberationId: started.deliberationId,
        now: () => new Date("2026-08-22T00:02:01.000Z"),
      }),
    ).rejects.toMatchObject({ code: "deliberation_source_failed" });
    await expect(
      store.inspect({
        projectId: "prj_deliberation01",
        deliberationId: started.deliberationId,
      }),
    ).resolves.toMatchObject({ state: "uncertain", summary: null, reconciliation: null });
    store.close();
  });

  it("migrates and reconciles an existing version 1 uncertain job", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-deliberation-v1-"));
    roots.push(root);
    const path = resolve(root, "deliberations.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE conversation_deliberation_jobs (
        project_id TEXT NOT NULL, source_event_id TEXT NOT NULL,
        deliberation_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
        principal_hash TEXT NOT NULL, policy_id TEXT NOT NULL, topic TEXT NOT NULL,
        requested_at TEXT NOT NULL, requested_at_ms INTEGER NOT NULL, state TEXT NOT NULL,
        attempt_count INTEGER NOT NULL, lease_id TEXT, lease_owner TEXT,
        lease_expires_at TEXT, lease_expires_at_ms INTEGER, summary_json TEXT,
        failure_code TEXT, terminal_at TEXT, PRIMARY KEY (project_id, source_event_id)
      );
      CREATE UNIQUE INDEX conversation_deliberation_jobs_active_lease
        ON conversation_deliberation_jobs(lease_id) WHERE lease_id IS NOT NULL;
      CREATE TRIGGER conversation_deliberation_job_identity_immutable
        BEFORE UPDATE ON conversation_deliberation_jobs WHEN 0
        BEGIN SELECT RAISE(ABORT, 'identity'); END;
      CREATE TRIGGER conversation_deliberation_job_lifecycle
        BEFORE UPDATE ON conversation_deliberation_jobs WHEN 0
        BEGIN SELECT RAISE(ABORT, 'lifecycle'); END;
      CREATE TRIGGER conversation_deliberation_job_no_delete
        BEFORE DELETE ON conversation_deliberation_jobs
        BEGIN SELECT RAISE(ABORT, 'cannot be deleted'); END;
      INSERT INTO conversation_deliberation_jobs VALUES (
        'prj_deliberation01', '${sourceEventId}', 'dlb_legacyqueue0001',
        'sha256:${"1".repeat(64)}', 'sha256:${"2".repeat(64)}',
        'deliberation_product-review', 'Existing queue request.',
        '2026-08-22T00:00:00.000Z', 1787356800000, 'uncertain', 1,
        NULL, NULL, NULL, NULL, NULL, 'worker_lease_expired', '2026-08-22T00:01:00.000Z'
      );
      PRAGMA user_version = 1;
    `);
    legacy.close();

    const store = await SQLiteConversationDeliberationJobStore.open({ path });
    await expect(
      store.inspect({
        projectId: "prj_deliberation01",
        deliberationId: "dlb_legacyqueue0001",
      }),
    ).resolves.toMatchObject({
      state: "uncertain",
      failureCode: "worker_lease_expired",
      reconciliation: null,
    });
    await store.reconcile({
      projectId: "prj_deliberation01",
      deliberationId: "dlb_legacyqueue0001",
      requestHash: `sha256:${"1".repeat(64)}`,
      sourceKind: "fixture_project_inspection_v1",
      evidenceHash: `sha256:${"3".repeat(64)}`,
      reconciledAt: "2026-08-22T00:02:00.000Z",
      summary: {
        deliberationId: "dlb_legacyqueue0001",
        status: "failed",
        artifactCount: 1,
        nextAction: "none",
      },
    });
    await expect(
      store.inspect({
        projectId: "prj_deliberation01",
        deliberationId: "dlb_legacyqueue0001",
      }),
    ).resolves.toMatchObject({
      state: "settled",
      summary: { status: "failed" },
      reconciliation: { priorFailureCode: "worker_lease_expired" },
    });
    store.close();
    const migrated = new DatabaseSync(path);
    expect(migrated.prepare("PRAGMA user_version").get()?.user_version).toBe(2);
    expect(
      migrated
        .prepare("PRAGMA table_info(conversation_deliberation_jobs)")
        .all()
        .some((column) => column.name === "reconciliation_json"),
    ).toBe(true);
    migrated.close();
  });
});
