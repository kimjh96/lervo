import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireWorkspaceIntegrationTargetLease,
  beginWorkspaceIntegrationAdvancement,
  claimAssignment,
  commitWorkspaceIntegrationAttempt,
  createAssignment,
  listWorkspaceIntegrationAttempts,
  registerAgent,
  releaseWorkspaceIntegrationAttempt,
  updateWorkspaceIntegrationAttempt,
  readWorkspace,
  type AgentWorkspace,
  type WorkspaceIntegrationAttempt,
} from "../src/index.js";

const roots: string[] = [];
const before = "a".repeat(40);
const candidate = "e".repeat(40);
const hash = `sha256:${"c".repeat(64)}`;
const createdAt = "2026-08-26T00:10:00.000Z";

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-integration-release-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_integration_release",
      now: new Date("2026-08-26T00:00:00Z"),
    }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function attempt(integrationAssignmentId = `asn_${"4".repeat(24)}`): WorkspaceIntegrationAttempt {
  return {
    schemaVersion: 1,
    attemptId: `int_${"1".repeat(24)}`,
    targetLeaseId: `itl_${"2".repeat(24)}`,
    planContentHash: hash,
    repositoryInstanceId: `rpi_${"3".repeat(24)}`,
    targetDigest: hash,
    targetGeneration: 1,
    targetBeforeCommit: before,
    integrationAssignmentId,
    integratorAgentId: `agt_${"5".repeat(24)}`,
    integratorWorkspaceId: `wsp_${"6".repeat(24)}`,
    integratorWorkspaceGeneration: 1,
    sources: [
      {
        workspaceId: `wsp_${"7".repeat(24)}`,
        generation: 1,
        headCommit: candidate,
        treeHash: "f".repeat(40),
        strategy: "fast_forward",
      },
    ],
    state: "leased",
    candidateCommit: null,
    candidateTreeHash: null,
    verificationReceiptHash: null,
    verificationResults: [],
    targetAfterCommit: null,
    conflictWorkspaceId: null,
    conflictReason: null,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

async function stored(
  repositoryRoot: string,
  state: WorkspaceIntegrationAttempt["state"],
  integrationAssignmentId?: string,
) {
  let current = await acquireWorkspaceIntegrationTargetLease({
    repositoryRoot,
    attempt: attempt(integrationAssignmentId),
    eventId: "evt_release_lease_01",
  });
  const coordinate = () => ({
    repositoryRoot,
    targetLeaseId: current.attempt.targetLeaseId,
    expectedContentHash: current.contentHash,
    expectedRevision: current.attempt.revision,
  });
  if (state === "leased") return current;
  current = await updateWorkspaceIntegrationAttempt({
    ...coordinate(),
    eventId: "evt_release_prepared_01",
    occurredAt: "2026-08-26T00:10:01.000Z",
    ...(state === "conflict"
      ? {
          nextState: "conflict" as const,
          conflictWorkspaceId: `wsp_${"7".repeat(24)}`,
          conflictReason: "git_conflict" as const,
        }
      : {
          nextState: "candidate" as const,
          candidateCommit: candidate,
          candidateTreeHash: "f".repeat(40),
        }),
  });
  if (state === "candidate" || state === "conflict") return current;
  current = await beginWorkspaceIntegrationAdvancement({
    ...coordinate(),
    eventId: "evt_release_advancing_01",
    occurredAt: "2026-08-26T00:10:02.000Z",
    verificationReceiptHash: hash,
    verificationResults: [
      {
        suiteId: "project.quick",
        suiteHash: hash,
        verificationId: "ver_release_check_01",
        resultArtifactId: "art_release_check_01",
        resultContentHash: hash,
      },
    ],
  });
  if (state === "advancing") return current;
  return commitWorkspaceIntegrationAttempt({
    ...coordinate(),
    eventId: "evt_release_integrated_01",
    occurredAt: "2026-08-26T00:10:03.000Z",
  });
}

function release(
  repositoryRoot: string,
  current: { attempt: WorkspaceIntegrationAttempt; contentHash: string },
  overrides: Partial<Parameters<typeof releaseWorkspaceIntegrationAttempt>[0]> = {},
) {
  return releaseWorkspaceIntegrationAttempt({
    repositoryRoot,
    targetLeaseId: current.attempt.targetLeaseId,
    expectedContentHash: current.contentHash,
    expectedRevision: current.attempt.revision,
    eventId: "evt_release_released_01",
    occurredAt: "2026-08-26T00:20:00.000Z",
    candidateReachedTarget: async () => false,
    ...overrides,
  });
}

async function leasedAssignment(repositoryRoot: string, claimedAt: string) {
  const agent = await registerAgent({ repositoryRoot, roleId: "developer" });
  const assignment = await createAssignment({
    repositoryRoot,
    taskType: "repository.integration",
    roleId: "developer",
    acceptanceCriteria: ["Integrate the sealed candidate."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: ["docs"],
  });
  return claimAssignment({
    repositoryRoot,
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_integration_release_01",
    leaseDurationMs: 30 * 60_000,
    now: new Date(claimedAt),
  });
}

/** The attempt's sealed source, moved to `integrating` when the attempt started. */
async function integratingSource(repositoryRoot: string) {
  const source: AgentWorkspace = {
    schemaVersion: 1,
    workspaceId: `wsp_${"7".repeat(24)}`,
    generation: 1,
    repositoryInstanceId: `rpi_${"3".repeat(24)}`,
    projectId: "prj_integration_release",
    assignmentId: `asn_${"8".repeat(24)}`,
    agentId: `agt_${"9".repeat(24)}`,
    leaseGeneration: 1,
    executionKind: "worker",
    host: { kind: "git", version: "1.0.0", nativeInstanceDigest: null },
    baseCommit: before,
    integrationTargetDigest: hash,
    creationPlanId: `wpl_${"0".repeat(24)}`,
    markerHash: hash,
    pathDigest: hash,
    state: "integrating",
    writerSession: null,
    sealedResult: {
      baseCommit: before,
      headCommit: candidate,
      treeHash: "f".repeat(40),
      changedPathSetDigest: hash,
      changedPathCount: 1,
      changedPaths: ["docs/requirement.md"],
      commitIds: [candidate],
      resultArtifactId: "art_release_source_01",
      resultArtifactHash: hash,
      verificationResults: [],
      approvalPending: false,
      recoveryPending: false,
      sourceWorkstream: null,
      noChange: false,
      sealedAt: "2026-08-26T00:09:00.000Z",
    },
    integrationQueueEntryId: `inq_${"1".repeat(24)}`,
    integrationEvidenceId: null,
    cleanupPlanId: null,
    recoveryReason: null,
    revision: 3,
    createdAt: "2026-08-26T00:08:00.000Z",
    updatedAt: "2026-08-26T00:10:00.000Z",
  };
  const records = await RepositoryCoordinationRecords.open(repositoryRoot);
  await records.write({
    collection: "workspaces",
    recordId: source.workspaceId,
    value: source,
    expectedContentHash: null,
  });
  return source.workspaceId;
}

describe("workspace integration attempt release", () => {
  it.each(["leased", "candidate", "conflict"] as const)(
    "releases a %s attempt that left its target unchanged and keeps its generation",
    async (state) => {
      const repositoryRoot = await fixture();
      const current = await stored(repositoryRoot, state);
      const released = await release(repositoryRoot, current);
      expect(released.attempt).toMatchObject({
        state: "released",
        targetGeneration: 1,
        revision: current.attempt.revision + 1,
        candidateCommit: current.attempt.candidateCommit,
        conflictWorkspaceId: current.attempt.conflictWorkspaceId,
      });
      expect(await listWorkspaceIntegrationAttempts(repositoryRoot)).toEqual([released.attempt]);
      const records = await RepositoryCoordinationRecords.open(repositoryRoot);
      expect((await records.read("events", "evt_release_released_01"))!.value).toMatchObject({
        type: "assignment.integration.state.changed",
        previousState: state,
        state: "released",
      });
    },
  );

  it("refuses a stale content hash or revision", async () => {
    const repositoryRoot = await fixture();
    const current = await stored(repositoryRoot, "candidate");
    await expect(
      release(repositoryRoot, current, { expectedContentHash: `sha256:${"9".repeat(64)}` }),
    ).rejects.toMatchObject({ code: "workspace_transition_conflict" });
    await expect(release(repositoryRoot, current, { expectedRevision: 1 })).rejects.toMatchObject({
      code: "workspace_transition_conflict",
    });
    const released = await release(repositoryRoot, current);
    await expect(release(repositoryRoot, current)).rejects.toMatchObject({
      code: "workspace_transition_conflict",
    });
    expect(released.attempt.state).toBe("released");
  });

  it.each(["advancing", "integrated"] as const)("never releases an %s attempt", async (state) => {
    const repositoryRoot = await fixture();
    const current = await stored(repositoryRoot, state);
    await expect(release(repositoryRoot, current)).rejects.toMatchObject({
      code: "workspace_transition_conflict",
    });
    expect((await listWorkspaceIntegrationAttempts(repositoryRoot))[0]!.state).toBe(state);
  });

  it("refuses once the candidate reached the target and asks only about recorded candidates", async () => {
    const repositoryRoot = await fixture();
    const current = await stored(repositoryRoot, "candidate");
    const asked: string[] = [];
    await expect(
      release(repositoryRoot, current, {
        candidateReachedTarget: async (commit) => {
          asked.push(commit);
          return true;
        },
      }),
    ).rejects.toMatchObject({ code: "workspace_transition_conflict" });
    expect(asked).toEqual([candidate]);
    expect((await listWorkspaceIntegrationAttempts(repositoryRoot))[0]!.state).toBe("candidate");
    // A target that moved elsewhere, as synchronization moves it, no longer blocks release.
    await expect(release(repositoryRoot, current)).resolves.toMatchObject({
      attempt: { state: "released" },
    });
  });

  it("releases a crashed lease's attempt once that lease expired", async () => {
    const repositoryRoot = await fixture();
    const assignment = await leasedAssignment(repositoryRoot, "2026-08-26T00:05:00.000Z");
    const current = await stored(repositoryRoot, "leased", assignment.assignmentId);
    await expect(release(repositoryRoot, current)).rejects.toMatchObject({
      code: "workspace_transition_conflict",
    });
    // The lease stays recorded as `leased`, but it expired at 00:35.
    await expect(
      release(repositoryRoot, current, { occurredAt: "2026-08-26T00:40:00.000Z" }),
    ).resolves.toMatchObject({ attempt: { state: "released" } });
  });

  it("lets exactly one of release and advancement win the same revision", async () => {
    const repositoryRoot = await fixture();
    const current = await stored(repositoryRoot, "candidate");
    const outcomes = await Promise.allSettled([
      release(repositoryRoot, current),
      beginWorkspaceIntegrationAdvancement({
        repositoryRoot,
        targetLeaseId: current.attempt.targetLeaseId,
        expectedContentHash: current.contentHash,
        expectedRevision: current.attempt.revision,
        eventId: "evt_release_race_advancing",
        occurredAt: "2026-08-26T00:20:00.000Z",
        verificationReceiptHash: hash,
        verificationResults: [
          {
            suiteId: "project.quick",
            suiteHash: hash,
            verificationId: "ver_release_race_01",
            resultArtifactId: "art_release_race_01",
            resultContentHash: hash,
          },
        ],
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const [attempt] = await listWorkspaceIntegrationAttempts(repositoryRoot);
    expect(attempt!.revision).toBe(current.attempt.revision + 1);
    expect(["released", "advancing"]).toContain(attempt!.state);
  });

  it("refuses while the creating lease is live unless that lease, restarted, releases its own attempt", async () => {
    const repositoryRoot = await fixture();
    const assignment = await leasedAssignment(repositoryRoot, "2026-08-26T00:05:00.000Z");
    const current = await stored(repositoryRoot, "candidate", assignment.assignmentId);
    await expect(release(repositoryRoot, current)).rejects.toMatchObject({
      code: "workspace_transition_conflict",
    });
    await expect(
      release(repositoryRoot, current, { holderLeaseId: "lease_another_holder" }),
    ).rejects.toMatchObject({ code: "workspace_transition_conflict" });
    await expect(
      release(repositoryRoot, current, { holderLeaseId: assignment.lease!.leaseId }),
    ).resolves.toMatchObject({ attempt: { state: "released" } });
  });

  it("releases after a newer lease replaced the creating one", async () => {
    const repositoryRoot = await fixture();
    // The assignment's current lease was acquired after the attempt, so the creator has ended.
    const assignment = await leasedAssignment(repositoryRoot, "2026-08-26T00:15:00.000Z");
    const current = await stored(repositoryRoot, "candidate", assignment.assignmentId);
    await expect(release(repositoryRoot, current)).resolves.toMatchObject({
      attempt: { state: "released" },
    });
  });

  it("returns the released attempt's integrating source to its queue entry", async () => {
    const repositoryRoot = await fixture();
    const workspaceId = await integratingSource(repositoryRoot);
    await release(repositoryRoot, await stored(repositoryRoot, "candidate"));
    const requeued = await readWorkspace(repositoryRoot, workspaceId);
    expect(requeued!.workspace).toMatchObject({
      state: "integration_pending",
      integrationQueueEntryId: `inq_${"1".repeat(24)}`,
      revision: 4,
    });
    const records = await RepositoryCoordinationRecords.open(repositoryRoot);
    expect(
      (
        await records.list<{ workspaceId?: string; previousState: string; reasonCode: string }>(
          "events",
        )
      )
        .map((record) => record.value)
        .filter((event) => event.workspaceId === workspaceId),
    ).toEqual([
      expect.objectContaining({
        previousState: "integrating",
        reasonCode: "integration_attempt_released",
      }),
    ]);
  });

  it("leaves a source in place while another unreleased attempt names it", async () => {
    const repositoryRoot = await fixture();
    const workspaceId = await integratingSource(repositoryRoot);
    const current = await stored(repositoryRoot, "candidate");
    await acquireWorkspaceIntegrationTargetLease({
      repositoryRoot,
      attempt: {
        ...attempt(),
        attemptId: `int_${"8".repeat(24)}`,
        targetLeaseId: `itl_${"9".repeat(24)}`,
        targetGeneration: 2,
      },
      eventId: "evt_release_lease_02",
    });
    await release(repositoryRoot, current);
    expect((await readWorkspace(repositoryRoot, workspaceId))!.workspace.state).toBe("integrating");
  });
});
