import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AutomaticTopologyEffectV1 } from "@lervo/application-contract";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  automaticTopologyEffectFields,
  createAssignmentTopologyPlan,
  operatingContractHash,
  operatingEffectAdmissionHash,
  reviewOperatingAction,
  projectAssignmentTopologyHistory,
} from "@lervo/work-controller";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerAgent,
  claimAssignment,
  activateTopologyAssignment,
  listAssignments,
  SupervisionTopologyMaterializer,
  SupervisionDecisionJournal,
  SupervisionResponsibilityClaimer,
  SQLiteSupervisionOwnerLeaseStore,
} from "../src/index.js";
import {
  responsibility,
  plan,
  mandate,
  snapshot,
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
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-topology-"));
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
  Object.assign(task, {
    executorAgentId: agent.agentId,
    reviewerAgentId: agent.agentId,
    roleVersion: agent.roleVersion,
    roleContractHash: agent.roleContractHash,
    assignmentRevision: 2,
  });
  const request = {
    schemaVersion: 2 as const,
    kind: "assignment_topology.change" as const,
    workstreamId: action.workstreamId,
    expectedGraphHash: action.graphHash,
    changeKey: "save-fix",
    nodes: [
      {
        nodeKey: "fix",
        taskType: "implementation",
        roleId: agent.roleId,
        roleVersion: agent.roleVersion,
        roleContractHash: agent.roleContractHash,
        requiredCapabilityHash: null,
        priority: 50,
        dependencyAssignmentIds: [],
        dependencyNodeKeys: [],
        acceptanceCriteria: task.acceptanceCriteria,
        verificationSuiteIds: task.verificationSuiteIds,
        approvalRequirements: [],
        expectedPaths: task.expectedPaths,
      },
    ],
  };
  const topology = createAssignmentTopologyPlan({
    projectId: action.projectId,
    currentWorkstreamId: action.workstreamId,
    currentGraphHash: action.graphHash,
    graphValid: true,
    request,
    roleContracts: [
      {
        roleId: agent.roleId,
        roleVersion: agent.roleVersion,
        roleContractHash: agent.roleContractHash,
      },
    ],
    assignments: [],
  });
  task.assignmentId = topology.steps[0]!.assignmentId;
  const effect: AutomaticTopologyEffectV1 = {
    schemaVersion: 1,
    kind: "assignment_topology.automatic_effect",
    request,
    topology,
    responsibility: task,
    provider: action.provider,
    reservedTokens: 1000,
  };
  Object.assign(action, automaticTopologyEffectFields(effect), { ownerAgentId: agent.agentId });
  const installed = { ...mandate(), ownerAgentId: agent.agentId };
  action.mandateHash = operatingContractHash(installed);
  const review = reviewOperatingAction({
    mandate: installed,
    plan: action,
    snapshot: {
      ...snapshot(),
      installedMandateHash: action.mandateHash,
      effectAdmissionHash: operatingEffectAdmissionHash(action),
      effectMappings: [{ actionKind: "allocate_existing", contract: action.effectContract }],
    },
  });
  expect(review.disposition).toBe("admitted");
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId: action.projectId,
    writableEventSchemaVersion: 3,
  });
  stores.push(events);
  events.append({
    eventId: action.causationEventIds[0]!,
    projectId: action.projectId,
    runId: "run_topology_cause",
    sessionId: "ses_topology_cause",
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
    workstreamRevision: 1,
    sessionId: "ses_topology_owner",
    policyVersion: hash(),
  };
  const fence = {
    store: leaseStore,
    lease: leaseStore.acquire({
      supervisionId: action.supervisionId,
      ownerAgentId: agent.agentId,
      nowMs: Date.parse(now),
      durationMs: 300000,
    })!,
  };
  const decisions = new SupervisionDecisionJournal(
    events,
    artifacts,
    coordinates,
    () => now,
    fence,
  );
  await decisions.recordDecision(action, review);
  const materializer = new SupervisionTopologyMaterializer(
    root,
    events,
    artifacts,
    coordinates,
    () => now,
    fence,
  );
  return {
    root,
    action,
    effect,
    events,
    artifacts,
    coordinates,
    fence,
    materializer,
    decisions,
    agent,
  };
}
describe("automatic topology policy materialization", () => {
  it("supersedes an absent old-source effect under the same graph and owner fences", async () => {
    const f = await fixture();
    expect(await f.materializer.supersedeNotStarted(f.effect, f.action, hash("f"))).toBe(true);
    expect(await f.decisions.findPendingPlan()).toBeNull();
    await expect(
      f.materializer.materialize(
        f.effect,
        f.action,
        async () => f.effect.topology,
        async () => undefined,
      ),
    ).rejects.toThrow("superseded");
    expect(await listAssignments(f.root)).toEqual([]);
  });
  it("never supersedes an existing topology effect", async () => {
    const f = await fixture();
    await f.materializer.materialize(
      f.effect,
      f.action,
      async () => f.effect.topology,
      async () => undefined,
    );
    expect(await f.materializer.supersedeNotStarted(f.effect, f.action, hash("f"))).toBe(false);
    expect(await f.decisions.findPendingPlan()).not.toBeNull();
  });
  it("creates a blocked assignment with canonical policy evidence and claims only with its responsibility", async () => {
    const f = await fixture();
    expect(await f.materializer.inspect(f.effect, f.action)).toEqual({ status: "not_started" });
    const result = await f.materializer.materialize(
      f.effect,
      f.action,
      async () => f.effect.topology,
      async () => undefined,
    );
    const [assignment] = await listAssignments(f.root);
    expect(assignment!.status).toBe("blocked");
    expect(assignment!.topology!.policyReview).toBeDefined();
    expect(
      projectAssignmentTopologyHistory({
        events: f.events.list({}),
        workstreamId: f.action.workstreamId,
      }).status,
    ).toBe("valid");
    await expect(
      claimAssignment({
        repositoryRoot: f.root,
        assignmentId: assignment!.assignmentId,
        agentId: f.agent.agentId,
        sessionId: "ses_ordinary_claim",
        now: new Date(now),
      }),
    ).rejects.toThrow("responsibility binding");
    await expect(
      activateTopologyAssignment({
        repositoryRoot: f.root,
        assignmentId: assignment!.assignmentId,
        changeId: f.effect.topology.changeId,
      }),
    ).rejects.toThrow("responsibility claim");
    const claimer = new SupervisionResponsibilityClaimer(
      f.root,
      f.events,
      f.artifacts,
      f.coordinates,
      () => now,
      f.fence,
    );
    const claimed = await claimer.claim(
      {
        responsibility: f.effect.responsibility,
        expectedAssignmentHash: operatingContractHash(assignment),
        sessionId: "ses_topology_worker",
        leaseDurationMs: 60000,
        maximumDeadlineMs: 3600000,
        causationEventIds: result.effectEventIds,
      },
      async () => undefined,
    );
    expect(claimed.assignment.revision).toBe(2);
    expect(claimed.assignment.status).toBe("leased");
    expect(await f.materializer.inspect(f.effect, f.action)).toEqual(result);
    const count = f.events.latest()!.seq;
    expect(
      await f.materializer.materialize(
        f.effect,
        f.action,
        async () => {
          throw Error("Replay must not plan");
        },
        async () => {
          throw Error("Replay must not mutate");
        },
      ),
    ).toEqual(result);
    expect(f.events.latest()!.seq).toBe(count);
  });
  it.each([1, 2])(
    "restores assignment bytes when authority fails at observation %s",
    async (failure) => {
      const f = await fixture();
      let calls = 0;
      await expect(
        f.materializer.materialize(
          f.effect,
          f.action,
          async () => f.effect.topology,
          async () => {
            if (++calls === failure) throw Error("Revoked");
          },
        ),
      ).rejects.toThrow();
      expect(await listAssignments(f.root)).toEqual([]);
      expect(f.events.latest()!.seq).toBe(2);
    },
  );
  it("rejects changed actual graph or proposed effect scope before creating assignment", async () => {
    const f = await fixture();
    await expect(
      f.materializer.materialize(
        f.effect,
        f.action,
        async () => ({ ...f.effect.topology, currentGraphHash: hash("f") }),
        async () => undefined,
      ),
    ).rejects.toThrow("source changed");
    await expect(
      f.materializer.materialize(
        { ...f.effect, reservedTokens: 1 },
        f.action,
        async () => f.effect.topology,
        async () => undefined,
      ),
    ).rejects.toThrow("admitted scope");
    expect(await listAssignments(f.root)).toEqual([]);
  });
  it("rolls back assignment creation when the event transaction fails", async () => {
    const f = await fixture();
    vi.spyOn(f.events, "transact").mockImplementation(() => {
      throw Error("Fixture transaction failure");
    });
    await expect(
      f.materializer.materialize(
        f.effect,
        f.action,
        async () => f.effect.topology,
        async () => undefined,
      ),
    ).rejects.toThrow();
    expect(await listAssignments(f.root)).toEqual([]);
  });
  it("rejects stale policy owner fences without exposing a runnable assignment", async () => {
    const f = await fixture();
    f.fence.store.release(f.fence.lease);
    await expect(
      f.materializer.materialize(
        f.effect,
        f.action,
        async () => f.effect.topology,
        async () => undefined,
      ),
    ).rejects.toThrow();
    expect(await listAssignments(f.root)).toEqual([]);
  });
});
