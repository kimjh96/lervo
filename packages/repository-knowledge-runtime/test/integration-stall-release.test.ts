import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimAssignment,
  createAssignment,
  readWorkspaceIntegrationAttempt,
  registerAgent,
  type WorkspaceIntegrationAttempt,
} from "@lervo/agent-workforce";
import { RepositoryCoordinationRecords, repositoryCoordinateDigest } from "@lervo/project-storage";
import { releasedIntegrationStall } from "../src/integration-stall-release.js";
import { fixture } from "./fixture.js";

const TARGET_REF = "refs/heads/knowledge-integration";
const hash = `sha256:${"c".repeat(64)}`;
const roots: string[] = [];
afterEach(async () => {
  for (const directory of roots.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** A delegated repository whose integrator assignment failed at `failedAt`. */
async function repository(options: { leasedAt?: string } = {}) {
  const f = await fixture(true, true);
  roots.push(f.directory);
  await f.storage.close();
  const agent = await registerAgent({ repositoryRoot: f.root, roleId: "developer" });
  const assignment = await createAssignment({
    repositoryRoot: f.root,
    taskType: "repository.integration",
    roleId: "developer",
    acceptanceCriteria: ["Integrate the sealed canonical draft."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: ["docs"],
  });
  if (options.leasedAt !== undefined)
    await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: assignment.assignmentId,
      agentId: agent.agentId,
      sessionId: "ses_integration_stall_01",
      leaseDurationMs: 30 * 60_000,
      now: new Date(options.leasedAt),
    });
  return { root: f.root, assignmentId: assignment.assignmentId };
}

/** Writes an attempt on the delegated target, as an earlier lease left it. */
async function attempt(
  root: string,
  assignmentId: string,
  overrides: Partial<WorkspaceIntegrationAttempt>,
) {
  const before = git(root, "rev-parse", TARGET_REF);
  const candidate = git(root, "commit-tree", `${before}^{tree}`, "-p", before, "-m", "Candidate");
  const value: WorkspaceIntegrationAttempt = {
    schemaVersion: 1,
    attemptId: `int_${"1".repeat(24)}`,
    targetLeaseId: `itl_${"2".repeat(24)}`,
    planContentHash: hash,
    repositoryInstanceId: `rpi_${"3".repeat(24)}`,
    targetDigest: repositoryCoordinateDigest(TARGET_REF),
    targetGeneration: 1,
    targetBeforeCommit: before,
    integrationAssignmentId: assignmentId,
    integratorAgentId: `agt_${"5".repeat(24)}`,
    integratorWorkspaceId: `wsp_${"6".repeat(24)}`,
    integratorWorkspaceGeneration: 1,
    sources: [
      {
        workspaceId: `wsp_${"7".repeat(24)}`,
        generation: 1,
        headCommit: candidate,
        treeHash: git(root, "rev-parse", `${candidate}^{tree}`),
        strategy: "fast_forward",
      },
    ],
    state: "candidate",
    candidateCommit: candidate,
    candidateTreeHash: git(root, "rev-parse", `${candidate}^{tree}`),
    verificationReceiptHash: null,
    verificationResults: [],
    targetAfterCommit: null,
    conflictWorkspaceId: null,
    conflictReason: null,
    revision: 2,
    createdAt: "2026-11-23T00:10:00.000Z",
    updatedAt: "2026-11-23T00:10:01.000Z",
    ...overrides,
  };
  if (value.state === "advancing") value.targetAfterCommit = candidate;
  const records = await RepositoryCoordinationRecords.open(root);
  await records.write({
    collection: "integrationAttempts",
    recordId: value.targetLeaseId,
    value,
    expectedContentHash: null,
  });
  return value;
}

const FAILED_AT = "2026-11-23T00:20:00.000Z";

describe("released integration stall", () => {
  it("releases an orphan whose lease ended while the target never took its candidate", async () => {
    const { root, assignmentId } = await repository();
    const orphan = await attempt(root, assignmentId, {});
    expect(await releasedIntegrationStall(root, { assignmentId, returnedAt: FAILED_AT })).toBe(
      true,
    );
    expect((await readWorkspaceIntegrationAttempt(root, orphan.targetLeaseId))!.attempt.state).toBe(
      "released",
    );
    // An inspection that stopped before answering is settled by the next one.
    expect(await releasedIntegrationStall(root, { assignmentId, returnedAt: FAILED_AT })).toBe(
      true,
    );
  }, 30_000);

  it("keeps the stall when nothing blocks or a release predates the failure", async () => {
    const { root, assignmentId } = await repository();
    expect(await releasedIntegrationStall(root, { assignmentId, returnedAt: FAILED_AT })).toBe(
      false,
    );
    await attempt(root, assignmentId, {
      state: "released",
      revision: 3,
      updatedAt: "2026-11-23T00:15:00.000Z",
    });
    expect(await releasedIntegrationStall(root, { assignmentId, returnedAt: FAILED_AT })).toBe(
      false,
    );
  }, 30_000);

  it("keeps the stall while the attempt is advancing", async () => {
    const { root, assignmentId } = await repository();
    const target = git(root, "rev-parse", TARGET_REF);
    const advancing = await attempt(root, assignmentId, {
      state: "advancing",
      revision: 3,
      verificationReceiptHash: hash,
      verificationResults: [
        {
          suiteId: "project.quick",
          suiteHash: hash,
          verificationId: "ver_integration_stall_01",
          resultArtifactId: "art_integration_stall_01",
          resultContentHash: hash,
        },
      ],
    });
    expect(await releasedIntegrationStall(root, { assignmentId, returnedAt: FAILED_AT })).toBe(
      false,
    );
    expect(git(root, "rev-parse", TARGET_REF)).toBe(target);
    expect(
      (await readWorkspaceIntegrationAttempt(root, advancing.targetLeaseId))!.attempt.state,
    ).toBe("advancing");
  }, 30_000);

  it("keeps the stall while the creating lease is live", async () => {
    // The lease was acquired before the attempt and has not expired.
    const { root, assignmentId } = await repository({ leasedAt: new Date().toISOString() });
    const now = Date.now();
    const orphan = await attempt(root, assignmentId, {
      createdAt: new Date(now + 1_000).toISOString(),
      updatedAt: new Date(now + 2_000).toISOString(),
    });
    expect(
      await releasedIntegrationStall(root, {
        assignmentId,
        returnedAt: new Date(now - 60_000).toISOString(),
      }),
    ).toBe(false);
    expect((await readWorkspaceIntegrationAttempt(root, orphan.targetLeaseId))!.attempt.state).toBe(
      "candidate",
    );
  }, 30_000);

  it("ignores failures of assignments that do not integrate", async () => {
    const { root, assignmentId } = await repository();
    await attempt(root, assignmentId, {});
    expect(
      await releasedIntegrationStall(root, {
        assignmentId: `asn_${"9".repeat(24)}`,
        returnedAt: FAILED_AT,
      }),
    ).toBe(false);
    expect(await releasedIntegrationStall(root, { assignmentId, returnedAt: "unknown" })).toBe(
      false,
    );
  }, 30_000);
});
