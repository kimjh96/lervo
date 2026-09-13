import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { operatingContractHash } from "@lervo/work-controller";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerAgent,
  createAssignment,
  claimAssignment,
  listAssignments,
  SupervisionResponsibilityClaimer,
  SQLiteSupervisionOwnerLeaseStore,
} from "../src/index.js";
import {
  responsibility,
  plan,
  hash,
  now,
} from "../../work-controller/test/operating-supervision.fixture.js";

const roots: string[] = [];
const stores: (SQLiteEventStore | SQLiteSupervisionOwnerLeaseStore)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(writer: 2 | 3 = 3) {
  const root = await mkdtemp(resolve(tmpdir(), "responsibility-claim-"));
  roots.push(root);
  const action = plan();
  await applyInitPlan(await createInitPlan({ root, projectId: action.projectId }));
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["src"],
  });
  const task = responsibility();
  const before = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: agent.roleId,
    workstreamId: action.workstreamId,
    expectedPaths: task.expectedPaths,
    acceptanceCriteria: task.acceptanceCriteria,
    verificationSuiteIds: task.verificationSuiteIds,
  });
  Object.assign(task, {
    assignmentId: before.assignmentId,
    assignmentRevision: before.revision + 1,
    executorAgentId: agent.agentId,
    reviewerAgentId: agent.agentId,
    roleId: agent.roleId,
    roleVersion: agent.roleVersion,
    roleContractHash: agent.roleContractHash,
  });
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId: action.projectId,
    writableEventSchemaVersion: writer,
  });
  stores.push(events);
  events.append({
    eventId: action.causationEventIds[0]!,
    projectId: action.projectId,
    runId: "run_fixture_cause",
    sessionId: "ses_fixture_cause",
    type: "run.requested",
    schemaVersion: 1,
    occurredAt: now,
    policyVersion: hash(),
    actor: { kind: "user" },
    payload: {},
  });
  const artifacts = await FileSystemCas.open(resolve(root, "cas"));
  const leaseStore = SQLiteSupervisionOwnerLeaseStore.open(resolve(root, "leases.sqlite"));
  stores.push(leaseStore);
  const coordinates = {
    ...action,
    ownerAgentId: agent.agentId,
    workstreamRevision: 1,
    sessionId: "ses_claim_owner",
    policyVersion: hash(),
  };
  const lease = leaseStore.acquire({
    supervisionId: coordinates.supervisionId,
    ownerAgentId: agent.agentId,
    nowMs: Date.parse(now),
    durationMs: 300_000,
  })!;
  const fence = { store: leaseStore, lease };
  const claimer = new SupervisionResponsibilityClaimer(
    root,
    events,
    artifacts,
    coordinates,
    () => now,
    fence,
  );
  const input = {
    responsibility: task,
    expectedAssignmentHash: operatingContractHash(before),
    sessionId: "ses_claim_worker",
    leaseDurationMs: 60_000,
    maximumDeadlineMs: 3600_000,
    causationEventIds: action.causationEventIds,
  };
  return { root, before, events, artifacts, fence, claimer, input, agent };
}
describe("fenced assignment claim and responsibility binding", () => {
  it("records both events atomically at the actual resulting assignment revision and deduplicates", async () => {
    const f = await fixture();
    const states: string[] = [];
    const result = await f.claimer.claim(f.input, async (assignment) => {
      states.push(assignment.status);
    });
    expect(states).toEqual(["queued", "leased"]);
    expect(result.assignment.revision).toBe(f.before.revision + 1);
    expect(result.responsibility.responsibility.assignmentRevision).toBe(
      result.assignment.revision,
    );
    expect(f.events.latest()!.seq).toBe(3);
    expect(
      await f.claimer.claim(f.input, async () => {
        throw Error("Replay must not grant another lease");
      }),
    ).toEqual(result);
    expect(f.events.latest()!.seq).toBe(3);
    const binding = f.events.get(result.responsibility.eventId)!;
    expect(binding.payload.causationEventIds).toHaveLength(2);
    expect(JSON.stringify(binding.payload)).not.toContain(f.input.responsibility.taskPurpose);
  });
  it.each([1, 2])(
    "preserves exact assignment state when authority fails at observation %s",
    async (failure) => {
      const f = await fixture();
      let calls = 0;
      await expect(
        f.claimer.claim(f.input, async () => {
          if (++calls === failure) throw Error("Authority revoked");
        }),
      ).rejects.toThrow();
      expect((await listAssignments(f.root))[0]).toEqual(f.before);
      expect(f.events.latest()!.seq).toBe(1);
    },
  );
  it("rolls back the assignment and both events if the atomic event transaction fails", async () => {
    const f = await fixture();
    const transact = f.events.transact.bind(f.events);
    vi.spyOn(f.events, "transact").mockImplementation((operation) =>
      transact((transaction) => {
        operation(transaction);
        throw Error("Commit fixture failure");
      }),
    );
    await expect(f.claimer.claim(f.input, async () => undefined)).rejects.toThrow();
    expect((await listAssignments(f.root))[0]).toEqual(f.before);
    expect(f.events.latest()!.seq).toBe(1);
  });
  it("rejects a lost owner fence and restores the claim", async () => {
    const f = await fixture();
    let count = 0;
    await expect(
      f.claimer.claim(f.input, async () => {
        if (++count === 2) f.fence.store.release(f.fence.lease);
      }),
    ).rejects.toThrow();
    expect((await listAssignments(f.root))[0]).toEqual(f.before);
    expect(f.events.latest()!.seq).toBe(1);
  });
  it("cannot publish supervision evidence with an older writer", async () => {
    const f = await fixture(2);
    await expect(f.claimer.claim(f.input, async () => undefined)).rejects.toThrow();
    expect((await listAssignments(f.root))[0]).toEqual(f.before);
    expect(f.events.latest()!.seq).toBe(1);
  });
  it("does not replace an unresolved live lease", async () => {
    const f = await fixture();
    const claimed = await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: f.before.assignmentId,
      agentId: f.agent.agentId,
      sessionId: "ses_existing_worker",
      now: new Date(now),
    });
    f.input.expectedAssignmentHash = operatingContractHash(claimed);
    f.input.responsibility.assignmentRevision = claimed.revision + 1;
    await expect(f.claimer.claim(f.input, async () => undefined)).rejects.toThrow();
    expect((await listAssignments(f.root))[0]).toEqual(claimed);
    expect(f.events.latest()!.seq).toBe(1);
  });
  it("snapshots caller-owned responsibilities before asynchronous CAS work", async () => {
    const f = await fixture();
    const expected = structuredClone(f.input.responsibility);
    const pending = f.claimer.claim(f.input, async () => undefined);
    f.input.responsibility.taskPurpose = "Caller changed the draft";
    expect((await pending).responsibility.responsibility).toEqual(expected);
  });
});
