import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  QueuedConversationDeliberationBackend,
  reconcileConversationDeliberation,
  runConversationDeliberationResumeWorkerCycle,
} from "@lervo/conversation-control";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SQLiteConversationDeliberationJobStore,
  SQLiteConversationDeliberationResumeJobStore,
} from "../src/index.js";

const roots: string[] = [];
const projectId = "prj_deliberation01";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-deliberation-resume-"));
  roots.push(root);
  const startPath = resolve(root, "deliberations.sqlite");
  const resumePath = resolve(root, "deliberation-resumes.sqlite");
  const starts = await SQLiteConversationDeliberationJobStore.open({ path: startPath });
  const resumes = await SQLiteConversationDeliberationResumeJobStore.open({ path: resumePath });
  const backend = new QueuedConversationDeliberationBackend(starts, resumes);
  const started = await backend.start({
    projectId,
    principalId: "operator:reviewer",
    sourceEventId: `cve_${"a".repeat(64)}`,
    policyId: "deliberation_product-review",
    topic: "승인된 경계에서 재개합니다.",
    requestedAt: "2026-08-22T00:00:00.000Z",
  });
  const lease = await starts.claim({
    workerId: "start-worker",
    claimedAt: "2026-08-22T00:01:00.000Z",
    leaseDurationMs: 10_000,
  });
  if (lease === null) throw new Error("시작 queue lease가 없습니다.");
  await starts.markUncertain({
    deliberationId: started.deliberationId,
    leaseId: lease.leaseId,
    failedAt: "2026-08-22T00:01:01.000Z",
    failureCode: "deliberation_execution_uncertain",
  });
  const uncertain = await starts.inspect({ projectId, deliberationId: started.deliberationId });
  await starts.reconcile({
    projectId,
    deliberationId: started.deliberationId,
    requestHash: uncertain!.requestHash,
    sourceKind: "fixture_project_inspection_v1",
    evidenceHash: `sha256:${"b".repeat(64)}`,
    reconciledAt: "2026-08-22T00:02:00.000Z",
    summary: {
      deliberationId: started.deliberationId,
      status: "interrupted",
      artifactCount: 2,
      nextAction: "resume",
    },
  });
  return { root, startPath, resumePath, starts, resumes, backend, started };
}

describe("durable conversation deliberation resume queue", () => {
  it("keeps one resume request across restart and settles it once", async () => {
    const state = await fixture();
    const request = {
      projectId,
      principalId: "operator:reviewer",
      sourceEventId: `cve_${"c".repeat(64)}`,
      deliberationId: state.started.deliberationId,
      requestedAt: "2026-08-22T00:03:00.000Z",
    };
    const first = await state.backend.resume(request);
    const duplicate = await state.backend.resume({
      ...request,
      requestedAt: "2026-08-22T00:03:01.000Z",
    });
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ status: "running", nextAction: "wait" });
    expect((await stat(state.resumePath)).mode & 0o777).toBe(0o600);
    state.resumes.close();

    const resumes = await SQLiteConversationDeliberationResumeJobStore.open({
      path: state.resumePath,
    });
    const backend = new QueuedConversationDeliberationBackend(state.starts, resumes);
    const execute = vi.fn(async (job: { deliberationId: string }) => ({
      deliberationId: job.deliberationId,
      status: "converged" as const,
      artifactCount: 4,
      nextAction: "none" as const,
    }));
    await expect(runConversationDeliberationResumeWorkerCycle({
      store: resumes,
      executor: { execute },
      workerId: "resume-worker",
      now: () => new Date("2026-08-22T00:04:00.000Z"),
    })).resolves.toMatchObject({ status: "settled", deliberationId: first.deliberationId });
    expect(execute).toHaveBeenCalledOnce();
    await expect(backend.inspect({
      projectId,
      principalId: "operator:reader",
      deliberationId: first.deliberationId,
      inspectedAt: "2026-08-22T00:05:00.000Z",
    })).resolves.toMatchObject({ status: "converged", artifactCount: 4 });
    resumes.close();
    state.starts.close();

    const database = new DatabaseSync(state.resumePath);
    const row = database.prepare(`
      SELECT principal_hash FROM conversation_deliberation_resume_jobs
      WHERE deliberation_id = ?
    `).get(first.deliberationId);
    expect(row?.principal_hash).not.toBe("operator:reviewer");
    expect(() => database.prepare(
      "DELETE FROM conversation_deliberation_resume_jobs WHERE deliberation_id = ?",
    ).run(first.deliberationId)).toThrow("cannot be deleted");
    database.close();
  });

  it("rejects a second source event for the same approved resume boundary", async () => {
    const state = await fixture();
    await state.backend.resume({
      projectId,
      principalId: "operator:reviewer",
      sourceEventId: `cve_${"c".repeat(64)}`,
      deliberationId: state.started.deliberationId,
      requestedAt: "2026-08-22T00:03:00.000Z",
    });
    await expect(state.backend.resume({
      projectId,
      principalId: "operator:reviewer",
      sourceEventId: `cve_${"d".repeat(64)}`,
      deliberationId: state.started.deliberationId,
      requestedAt: "2026-08-22T00:03:01.000Z",
    })).rejects.toMatchObject({ code: "deliberation_resume_conflict" });
    state.resumes.close();
    state.starts.close();
  });

  it("never reruns an expired resume lease and can reconcile only a terminal outcome", async () => {
    const state = await fixture();
    await state.backend.resume({
      projectId,
      principalId: "operator:reviewer",
      sourceEventId: `cve_${"e".repeat(64)}`,
      deliberationId: state.started.deliberationId,
      requestedAt: "2026-08-22T00:03:00.000Z",
    });
    const lease = await state.resumes.claim({
      workerId: "resume-worker-that-stopped",
      claimedAt: "2026-08-22T00:04:00.000Z",
      leaseDurationMs: 10_000,
    });
    if (lease === null) throw new Error("재개 queue lease가 없습니다.");
    const execute = vi.fn();
    await expect(runConversationDeliberationResumeWorkerCycle({
      store: state.resumes,
      executor: { execute },
      workerId: "replacement-resume-worker",
      now: () => new Date("2026-08-22T00:04:11.000Z"),
    })).resolves.toEqual({ status: "idle" });
    expect(execute).not.toHaveBeenCalled();
    await expect(state.backend.inspect({
      projectId,
      principalId: "operator:reader",
      deliberationId: state.started.deliberationId,
      inspectedAt: "2026-08-22T00:04:11.000Z",
    })).resolves.toMatchObject({ status: "unknown", nextAction: "none" });
    await expect(reconcileConversationDeliberation({
      store: state.resumes,
      source: {
        inspect: async () => ({
          status: "confirmed",
          sourceKind: "fixture_project_inspection_v1",
          evidenceHash: `sha256:${"6".repeat(64)}`,
          summary: {
            deliberationId: state.started.deliberationId,
            status: "interrupted",
            artifactCount: 2,
            nextAction: "resume",
          },
        }),
      },
      projectId,
      deliberationId: state.started.deliberationId,
      now: () => new Date("2026-08-22T00:04:30.000Z"),
    })).rejects.toMatchObject({ code: "integrity_failed" });
    await expect(reconcileConversationDeliberation({
      store: state.resumes,
      source: {
        inspect: async () => ({
          status: "confirmed",
          sourceKind: "fixture_project_inspection_v1",
          evidenceHash: `sha256:${"f".repeat(64)}`,
          summary: {
            deliberationId: state.started.deliberationId,
            status: "converged",
            artifactCount: 4,
            nextAction: "none",
          },
        }),
      },
      projectId,
      deliberationId: state.started.deliberationId,
      now: () => new Date("2026-08-22T00:05:00.000Z"),
    })).resolves.toMatchObject({ status: "reconciled", summary: { status: "converged" } });
    state.resumes.close();
    state.starts.close();
  });
});
