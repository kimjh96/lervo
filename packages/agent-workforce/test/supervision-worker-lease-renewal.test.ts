import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { operatingContractHash } from "@lervo/work-controller";
import {
  claimAssignment,
  createAssignment,
  registerAgent,
  renewSupervisedWorkerLease,
  SQLiteSupervisionOwnerLeaseStore,
} from "../src/index.js";

const roots: string[] = [];
const stores: { close(): void }[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("renews only a near-expiry exact live lease and records one canonical event", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-worker-lease-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  const projectId = `prj_${"a".repeat(16)}`;
  await applyInitPlan(await createInitPlan({ root, projectId }));
  const start = Date.parse("2026-09-14T09:29:06.000Z");
  let nowMs = start;
  const now = () => new Date(nowMs).toISOString();
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["src"],
  });
  const assignment = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: "developer",
    expectedPaths: ["src"],
    acceptanceCriteria: ["Preserve verified behavior"],
    verificationSuiteIds: ["role.development.artifact"],
  });
  const claimed = await claimAssignment({
    repositoryRoot: root,
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_worker_lease",
    leaseDurationMs: 300_000,
    now: new Date(nowMs),
  });
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: 3,
  });
  stores.push(events);
  const artifacts = await FileSystemCas.open(resolve(root, "cas"));
  const leases = SQLiteSupervisionOwnerLeaseStore.open(resolve(root, "leases.sqlite"));
  stores.push(leases);
  const ownerAgentId = `agt_${"b".repeat(24)}`;
  const lease = leases.acquire({
    supervisionId: "supervision.project",
    ownerAgentId,
    nowMs,
    durationMs: 300_000,
  })!;
  const base = {
    repositoryRoot: root,
    events,
    artifacts,
    coordinates: {
      projectId,
      workstreamId: `wks_${"c".repeat(24)}`,
      workstreamRevision: 1,
      supervisionId: "supervision.project",
      ownerAgentId,
      mandateHash: operatingContractHash("mandate"),
      sessionId: "ses_fixture_supervision",
      policyVersion: operatingContractHash("policy"),
    },
    now,
    fence: { store: leases, lease },
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    leaseId: claimed.lease!.leaseId,
    leaseDurationMs: 300_000,
  };
  expect(await renewSupervisedWorkerLease(base)).toBeNull();
  expect(events.list()).toHaveLength(0);
  nowMs = start + 200_000;
  const renewed = await renewSupervisedWorkerLease(base);
  expect(renewed?.lease?.expiresAt).toBe(new Date(nowMs + 300_000).toISOString());
  expect(renewed?.lease?.leaseId).toBe(claimed.lease!.leaseId);
  const recorded = events.list().filter((event) => event.type === "assignment.lease.renewed");
  expect(recorded).toHaveLength(1);
  expect(recorded[0]!.payload).toMatchObject({
    assignmentId: assignment.assignmentId,
    leaseId: claimed.lease!.leaseId,
    expiresAt: renewed!.lease!.expiresAt,
  });
  expect(await renewSupervisedWorkerLease(base)).toBeNull();
  await expect(
    renewSupervisedWorkerLease({ ...base, leaseId: `lse_${"d".repeat(24)}` }),
  ).rejects.toThrow(/exact live lease/u);
  nowMs = start + 600_000;
  await expect(renewSupervisedWorkerLease(base)).rejects.toThrow(/exact live lease/u);
});
