import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireWorkspaceIntegrationTargetLease,
  readWorkspaceIntegrationAttempt,
  updateWorkspaceIntegrationAttempt,
  type WorkspaceIntegrationAttempt,
} from "../src/index.js";

const roots: string[] = [];
const commit = "a".repeat(40);
const tree = "b".repeat(40);
const hash = `sha256:${"c".repeat(64)}`;

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-integration-attempt-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_integration_attempt",
      now: new Date("2026-08-26T00:00:00Z"),
    }),
  );
  return root;
}

function attempt(
  overrides: Partial<WorkspaceIntegrationAttempt> = {},
): WorkspaceIntegrationAttempt {
  return {
    schemaVersion: 1,
    attemptId: `int_${"1".repeat(24)}`,
    targetLeaseId: `itl_${"2".repeat(24)}`,
    planContentHash: hash,
    repositoryInstanceId: `rpi_${"3".repeat(24)}`,
    targetDigest: hash,
    targetGeneration: 1,
    targetBeforeCommit: commit,
    integrationAssignmentId: `asn_${"4".repeat(24)}`,
    integratorAgentId: `agt_${"5".repeat(24)}`,
    integratorWorkspaceId: `wsp_${"6".repeat(24)}`,
    integratorWorkspaceGeneration: 1,
    sources: [
      {
        workspaceId: `wsp_${"7".repeat(24)}`,
        generation: 1,
        headCommit: "d".repeat(40),
        treeHash: tree,
        strategy: "cherry_pick",
      },
    ],
    state: "leased",
    candidateCommit: null,
    candidateTreeHash: null,
    conflictWorkspaceId: null,
    conflictReason: null,
    revision: 1,
    createdAt: "2026-08-26T00:00:01Z",
    updatedAt: "2026-08-26T00:00:01Z",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace integration target leases", () => {
  it("acquires once, retries exact content, and rejects a competing plan", async () => {
    const repositoryRoot = await fixture();
    const first = attempt();
    const acquired = await acquireWorkspaceIntegrationTargetLease({
      repositoryRoot,
      attempt: first,
      eventId: "evt_integration_lease_01",
    });
    await expect(
      acquireWorkspaceIntegrationTargetLease({
        repositoryRoot,
        attempt: first,
        eventId: "evt_unused_retry_01",
      }),
    ).resolves.toEqual(acquired);
    await expect(
      acquireWorkspaceIntegrationTargetLease({
        repositoryRoot,
        attempt: attempt({ attemptId: `int_${"8".repeat(24)}` }),
        eventId: "evt_competing_lease_01",
      }),
    ).rejects.toMatchObject({ code: "workspace_transition_conflict" });
  });

  it("records a path-private candidate transition", async () => {
    const repositoryRoot = await fixture();
    const acquired = await acquireWorkspaceIntegrationTargetLease({
      repositoryRoot,
      attempt: attempt(),
      eventId: "evt_integration_lease_02",
    });
    const candidate = await updateWorkspaceIntegrationAttempt({
      repositoryRoot,
      targetLeaseId: acquired.attempt.targetLeaseId,
      expectedContentHash: acquired.contentHash,
      expectedRevision: 1,
      eventId: "evt_integration_candidate_02",
      nextState: "candidate",
      occurredAt: "2026-08-26T00:00:02Z",
      candidateCommit: "e".repeat(40),
      candidateTreeHash: "f".repeat(40),
    });
    expect(
      (await readWorkspaceIntegrationAttempt(repositoryRoot, acquired.attempt.targetLeaseId))!,
    ).toEqual(candidate);
    const records = await RepositoryCoordinationRecords.open(repositoryRoot);
    const serialized = JSON.stringify(await records.list("events"));
    expect(serialized).toContain("assignment.integration.state.changed");
    expect(serialized).not.toContain(repositoryRoot);
    expect(serialized).not.toContain("refs/heads/");
  });
});
