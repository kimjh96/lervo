import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  beginWorkspaceIntegrationAdvancement,
  claimAssignment,
  commitWorkspaceIntegrationAttempt,
  completeAssignment,
  createAssignment,
  readWorkspace,
  readWorkspaceIntegrationAttempt,
  registerAgent,
  updateWorkspace,
} from "@lervo/agent-workforce";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import type { VerificationResult, VerificationSuite } from "@lervo/schemas";
import {
  calculateVerificationId,
  verificationCommandDigest,
  verificationResultBytes,
  verificationSuiteHash,
} from "@lervo/verification-contract";
import { GitWorkspaceHostAdapter, GitWorkspaceIntegrationAdapter } from "@lervo/workspace-host-git";
import type { WorkspaceIntegrationHostAdapter } from "@lervo/workspace-host";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkspaceIntegrationCandidate,
  completeWorkspaceIntegration,
  applyWorkspaceProvision,
  applyWorkspaceSeal,
  planWorkspaceIntegrationCandidate,
  planWorkspaceProvision,
  planWorkspaceSeal,
  verifyWorkspaceIntegrationCandidate,
  type ManagedProjectVerification,
} from "../src/index.js";
import type { ManagedEventSpec } from "../src/telemetry.js";
import { MemoryArtifactStore } from "./fixture.js";
import { workspaceIntegrationCollisionReport } from "../src/workspace-integration-plan.js";

const execute = promisify(execFile);
const roots: string[] = [];
const hash = `sha256:${"a".repeat(64)}`;
const targetRef = "refs/heads/main";
const integrationSuite: VerificationSuite = {
  schemaVersion: 1,
  suiteId: "project.full",
  stopOnFailure: true,
  commands: [
    {
      commandId: "full-check",
      executable: "pnpm",
      arguments: ["check"],
      cwd: ".",
      timeoutMs: 120_000,
      maxOutputBytes: 16_384,
      environmentVariableNames: [],
    },
  ],
};

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_]);
  return stdout.trim();
}

async function activate(input: {
  repositoryRoot: string;
  workspaceId: string;
  sessionId: string;
  occurredAt: string;
}) {
  const stored = await readWorkspace(input.repositoryRoot, input.workspaceId);
  return (
    await updateWorkspace({
      repositoryRoot: input.repositoryRoot,
      workspaceId: input.workspaceId,
      expectedContentHash: stored!.contentHash,
      eventId: `evt_activate_${input.workspaceId.slice(4)}`,
      expectedRevision: stored!.workspace.revision,
      expectedGeneration: stored!.workspace.generation,
      nextState: "active",
      occurredAt: input.occurredAt,
      writerSession: { sessionId: input.sessionId, startedAt: input.occurredAt },
    })
  ).workspace;
}

async function fixture(options: { conflict?: boolean; targetAdvance?: boolean } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workspace-integration-"));
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-workspace-integration-parent-"));
  roots.push(root, parent);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_workspace_integration",
      now: new Date("2026-08-26T00:00:00Z"),
    }),
  );
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/base.ts"), "export const value = 'base';\n");
  await execute("git", ["-C", root, "init", "-b", "main"]);
  await git(root, "config", "user.email", "lervo-test@example.invalid");
  await git(root, "config", "user.name", "Lervo Test");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "fixture");
  const baseCommit = await git(root, "rev-parse", "HEAD");
  const selectedTargetRef = options.targetAdvance ? "refs/heads/integration-target" : targetRef;
  if (options.targetAdvance) await git(root, "branch", "integration-target", baseCommit);
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["*"],
    now: new Date("2026-08-26T00:00:01Z"),
  });
  const workerAssignment = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: "developer",
    acceptanceCriteria: ["Sealed."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: ["src"],
    now: new Date("2026-08-26T00:00:02Z"),
  });
  const workerLease = await claimAssignment({
    repositoryRoot: root,
    assignmentId: workerAssignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_worker_integration",
    now: new Date("2026-08-26T00:00:03Z"),
  });
  const host = new GitWorkspaceHostAdapter();
  const workerPath = resolve(parent, "worker");
  const workerProvision = await planWorkspaceProvision({
    repositoryRoot: root,
    workspacePath: workerPath,
    assignmentId: workerLease.assignmentId,
    agentId: agent.agentId,
    leaseId: workerLease.lease!.leaseId,
    provider: "codex",
    baseCommit,
    integrationTargetDigest: repositoryCoordinateDigest(selectedTargetRef),
    executionKind: "worker",
    host,
    now: new Date("2026-08-26T00:00:04Z"),
  });
  const readyWorker = await applyWorkspaceProvision({
    plan: workerProvision,
    host,
    now: new Date("2026-08-26T00:00:05Z"),
  });
  const activeWorker = await activate({
    repositoryRoot: root,
    workspaceId: readyWorker.workspaceId,
    sessionId: "ses_worker_integration",
    occurredAt: "2026-08-26T00:00:06Z",
  });
  await writeFile(
    resolve(workerPath, options.conflict ? "src/base.ts" : "src/worker.ts"),
    options.conflict ? "export const value = 'worker';\n" : "export const worker = true;\n",
  );
  await git(workerPath, "add", "src");
  await git(workerPath, "commit", "-m", "worker result");
  const sealPlan = await planWorkspaceSeal({
    repositoryRoot: root,
    workspacePath: workerPath,
    workspaceId: activeWorker.workspaceId,
    agentId: agent.agentId,
    leaseId: workerLease.lease!.leaseId,
    provider: "codex",
    writerSessionId: "ses_worker_integration",
    resultArtifactId: "art_workspace_result_integration",
    resultArtifactHash: hash,
    verificationResults: [
      {
        suiteId: "project.quick",
        policyHash: hash,
        resultArtifactId: "art_workspace_verify_integration",
        resultArtifactHash: hash,
        completedAt: "2026-08-26T00:00:07Z",
        passed: true,
      },
    ],
    host,
    now: new Date("2026-08-26T00:00:08Z"),
  });
  await applyWorkspaceSeal({
    plan: sealPlan,
    host,
    now: new Date("2026-08-26T00:00:09Z"),
  });
  await completeAssignment({
    repositoryRoot: root,
    assignmentId: workerLease.assignmentId,
    agentId: agent.agentId,
    leaseId: workerLease.lease!.leaseId,
    resultArtifacts: [{ artifactId: "art_workspace_result_integration", contentHash: hash }],
    verificationStatus: "passed",
    now: new Date("2026-08-26T00:00:10Z"),
  });
  if (options.conflict) {
    await writeFile(resolve(root, "src/base.ts"), "export const value = 'target';\n");
    await git(root, "add", "src/base.ts");
    await git(root, "commit", "-m", "target result");
  }
  const targetBeforeCommit = await git(root, "rev-parse", selectedTargetRef);
  const integrationAssignment = await createAssignment({
    repositoryRoot: root,
    taskType: "repository.integration",
    roleId: "developer",
    acceptanceCriteria: ["Candidate prepared."],
    verificationSuiteIds: ["project.full"],
    expectedPaths: ["*"],
    now: new Date("2026-08-26T00:00:11Z"),
  });
  const integrationLease = await claimAssignment({
    repositoryRoot: root,
    assignmentId: integrationAssignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_integrator_workspace",
    now: new Date("2026-08-26T00:00:12Z"),
  });
  const integrationPath = resolve(parent, "integration");
  const integrationProvision = await planWorkspaceProvision({
    repositoryRoot: root,
    workspacePath: integrationPath,
    assignmentId: integrationLease.assignmentId,
    agentId: agent.agentId,
    leaseId: integrationLease.lease!.leaseId,
    provider: "codex",
    baseCommit: targetBeforeCommit,
    integrationTargetDigest: repositoryCoordinateDigest(selectedTargetRef),
    executionKind: "integrator",
    host,
    now: new Date("2026-08-26T00:00:13Z"),
  });
  const readyIntegrator = await applyWorkspaceProvision({
    plan: integrationProvision,
    host,
    now: new Date("2026-08-26T00:00:14Z"),
  });
  const activeIntegrator = await activate({
    repositoryRoot: root,
    workspaceId: readyIntegrator.workspaceId,
    sessionId: "ses_integrator_workspace",
    occurredAt: "2026-08-26T00:00:15Z",
  });
  const integrationHost = new GitWorkspaceIntegrationAdapter(host);
  return {
    root,
    workerPath,
    integrationPath,
    worker: activeWorker,
    integrator: activeIntegrator,
    agent,
    integrationLease,
    targetBeforeCommit,
    targetRef: selectedTargetRef,
    integrationHost,
  };
}

async function plan(current: Awaited<ReturnType<typeof fixture>>) {
  return planWorkspaceIntegrationCandidate({
    repositoryRoot: current.root,
    integrationWorkspacePath: current.integrationPath,
    integrationWorkspaceId: current.integrator.workspaceId,
    integratorAgentId: current.agent.agentId,
    integratorWriterSessionId: "ses_integrator_workspace",
    leaseId: current.integrationLease.lease!.leaseId,
    provider: "codex",
    targetRef: current.targetRef,
    targetGeneration: 1,
    verificationSuites: [integrationSuite],
    selectedWorkspaceIds: [current.worker.workspaceId],
    integrationHost: current.integrationHost,
    now: new Date("2026-08-26T00:00:16Z"),
  });
}

async function passingVerification(
  artifacts: MemoryArtifactStore,
  suite: VerificationSuite,
  repositoryRevision: string,
): Promise<ManagedProjectVerification> {
  const output = await artifacts.put(new Uint8Array());
  const outputArtifact = {
    artifactId: `art_${output.contentHash.slice(7)}`,
    ...output,
  };
  const resultWithoutId: Omit<VerificationResult, "verificationId"> = {
    schemaVersion: 1,
    suiteId: suite.suiteId,
    suiteHash: verificationSuiteHash(suite),
    repositoryRevision,
    startedAt: "2026-08-26T00:00:18Z",
    completedAt: "2026-08-26T00:00:19Z",
    status: "passed",
    commands: suite.commands.map((command) => ({
      commandId: command.commandId,
      commandDigest: verificationCommandDigest(command),
      status: "passed" as const,
      exitCode: 0,
      startedAt: "2026-08-26T00:00:18Z",
      completedAt: "2026-08-26T00:00:19Z",
      durationMs: 1_000,
      stdoutArtifact: outputArtifact,
      stderrArtifact: outputArtifact,
      failureCode: null,
    })),
  };
  const result: VerificationResult = {
    ...resultWithoutId,
    verificationId: calculateVerificationId(resultWithoutId),
  };
  const stored = await artifacts.put(verificationResultBytes(result));
  return {
    result,
    resultArtifact: {
      artifactId: `art_${stored.contentHash.slice(7)}`,
      mediaType: "application/vnd.lervo.verification-result+json; charset=utf-8",
      ...stored,
    },
  };
}

async function prepareVerifiedCandidate(current: Awaited<ReturnType<typeof fixture>>) {
  const integrationPlan = await plan(current);
  const candidate = await applyWorkspaceIntegrationCandidate({
    plan: integrationPlan,
    integrationHost: current.integrationHost,
    now: new Date("2026-08-26T00:00:17Z"),
  });
  const artifacts = new MemoryArtifactStore();
  const verification = await verifyWorkspaceIntegrationCandidate({
    plan: integrationPlan,
    integrationHost: current.integrationHost,
    suites: [integrationSuite],
    verifier: {
      verify: ({ suite, repositoryRevision }) =>
        passingVerification(artifacts, suite, repositoryRevision),
    },
    artifactStore: artifacts,
    append: () => undefined,
    now: () => new Date("2026-08-26T00:00:20Z"),
  });
  return { integrationPlan, candidate, verification };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace integration candidate orchestration", () => {
  it("reports overlapping source paths without retaining the paths", () => {
    const report = workspaceIntegrationCollisionReport([
      { workspaceId: `wsp_${"1".repeat(24)}`, changedPaths: ["src/shared.ts", "src/a.ts"] },
      { workspaceId: `wsp_${"2".repeat(24)}`, changedPaths: ["src/shared.ts", "src/b.ts"] },
    ]);
    expect(report).toMatchObject({ changedPathUnionCount: 3 });
    expect(report.collisions).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain("src/shared.ts");
  });

  it("prepares one exact candidate while preserving the target ref", async () => {
    const current = await fixture();
    const integrationPlan = await plan(current);
    expect(integrationPlan).toMatchObject({
      targetBeforeCommit: current.targetBeforeCommit,
      changedPathUnionCount: 1,
      collisions: [],
    });
    const result = await applyWorkspaceIntegrationCandidate({
      plan: integrationPlan,
      integrationHost: current.integrationHost,
      now: new Date("2026-08-26T00:00:17Z"),
    });
    expect(result).toMatchObject({ status: "candidate", targetUnchanged: true });
    expect(await git(current.root, "rev-parse", targetRef)).toBe(current.targetBeforeCommit);
    expect(await git(current.integrationPath, "rev-parse", "HEAD")).toBe(result.candidateCommit);
    expect((await readWorkspace(current.root, current.worker.workspaceId))!.workspace.state).toBe(
      "integrating",
    );
    await expect(
      applyWorkspaceIntegrationCandidate({
        plan: integrationPlan,
        integrationHost: current.integrationHost,
        now: new Date("2026-08-26T00:00:18Z"),
      }),
    ).resolves.toEqual(result);
    const artifacts = new MemoryArtifactStore();
    const events: ManagedEventSpec[] = [];
    const verification = await verifyWorkspaceIntegrationCandidate({
      plan: integrationPlan,
      integrationHost: current.integrationHost,
      suites: [integrationSuite],
      verifier: {
        verify: ({ suite, repositoryRevision }) =>
          passingVerification(artifacts, suite, repositoryRevision),
      },
      artifactStore: artifacts,
      append: (specs) => events.push(...specs),
      now: () => new Date("2026-08-26T00:00:20Z"),
    });
    expect(verification).toMatchObject({
      attemptId: integrationPlan.attempt.attemptId,
      candidateCommit: result.candidateCommit,
      candidateTreeHash: result.candidateTreeHash,
      results: [{ suiteId: "project.full", suiteHash: verificationSuiteHash(integrationSuite) }],
    });
    expect(verification.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(events.map((event) => event.type)).toEqual([
      "verification.started",
      "verification.completed",
    ]);
    expect(await git(current.root, "rev-parse", targetRef)).toBe(current.targetBeforeCommit);
  }, 20_000);

  it("rejects verification suite drift before invoking the verifier", async () => {
    const current = await fixture();
    const integrationPlan = await plan(current);
    await applyWorkspaceIntegrationCandidate({
      plan: integrationPlan,
      integrationHost: current.integrationHost,
      now: new Date("2026-08-26T00:00:17Z"),
    });
    const changedSuite = structuredClone(integrationSuite);
    changedSuite.commands[0]!.timeoutMs += 1;
    let invoked = false;
    await expect(
      verifyWorkspaceIntegrationCandidate({
        plan: integrationPlan,
        integrationHost: current.integrationHost,
        suites: [changedSuite],
        verifier: {
          verify: async () => {
            invoked = true;
            throw new Error("must not run");
          },
        },
        artifactStore: new MemoryArtifactStore(),
        append: () => undefined,
        now: () => new Date("2026-08-26T00:00:20Z"),
      }),
    ).rejects.toMatchObject({ code: "host_coordinate_invalid" });
    expect(invoked).toBe(false);
  }, 20_000);

  it("rejects candidate bytes changed during verification", async () => {
    const current = await fixture();
    const integrationPlan = await plan(current);
    await applyWorkspaceIntegrationCandidate({
      plan: integrationPlan,
      integrationHost: current.integrationHost,
      now: new Date("2026-08-26T00:00:17Z"),
    });
    const artifacts = new MemoryArtifactStore();
    await expect(
      verifyWorkspaceIntegrationCandidate({
        plan: integrationPlan,
        integrationHost: current.integrationHost,
        suites: [integrationSuite],
        verifier: {
          verify: async ({ suite, repositoryRevision }) => {
            const verification = await passingVerification(artifacts, suite, repositoryRevision);
            await writeFile(resolve(current.integrationPath, "src/tampered.ts"), "tampered\n");
            return verification;
          },
        },
        artifactStore: artifacts,
        append: () => undefined,
        now: () => new Date("2026-08-26T00:00:20Z"),
      }),
    ).rejects.toMatchObject({ code: "host_effect_uncertain" });
    expect(await git(current.root, "rev-parse", targetRef)).toBe(current.targetBeforeCommit);
  }, 20_000);

  it("records exact integration success and projects every source as integrated", async () => {
    const current = await fixture({ targetAdvance: true });
    const { integrationPlan, candidate, verification } = await prepareVerifiedCandidate(current);
    const completed = await completeWorkspaceIntegration({
      plan: integrationPlan,
      verificationReceipt: verification,
      integrationHost: current.integrationHost,
      now: new Date("2026-08-26T00:00:21Z"),
    });
    expect(completed).toMatchObject({
      status: "integrated",
      attemptId: integrationPlan.attempt.attemptId,
      targetBeforeCommit: current.targetBeforeCommit,
      targetAfterCommit: candidate.candidateCommit,
      verificationReceiptHash: verification.contentHash,
      integratedWorkspaceIds: [current.worker.workspaceId],
    });
    expect(await git(current.root, "rev-parse", current.targetRef)).toBe(candidate.candidateCommit);
    expect(
      (await readWorkspace(current.root, current.worker.workspaceId))!.workspace,
    ).toMatchObject({
      state: "integrated",
      integrationEvidenceId: integrationPlan.attempt.attemptId,
    });
    const attempt = await readWorkspaceIntegrationAttempt(
      current.root,
      integrationPlan.attempt.targetLeaseId,
    );
    expect(attempt!.attempt.state).toBe("integrated");
    const records = await RepositoryCoordinationRecords.open(current.root);
    const recorded = await records.read<Record<string, unknown>>(
      "events",
      integrationPlan.integratedAttemptEventId,
    );
    expect(recorded!.value).toMatchObject({
      type: "assignment.integration.recorded",
      targetBeforeCommit: current.targetBeforeCommit,
      targetAfterCommit: candidate.candidateCommit,
      verificationReceiptHash: verification.contentHash,
    });
    expect(JSON.stringify(recorded!.value)).not.toContain(current.integrationPath);
    expect(JSON.stringify(recorded!.value)).not.toContain(current.targetRef);
    await expect(
      completeWorkspaceIntegration({
        plan: integrationPlan,
        verificationReceipt: verification,
        integrationHost: current.integrationHost,
        now: new Date("2026-08-26T00:00:22Z"),
      }),
    ).resolves.toEqual(completed);
  }, 20_000);

  it("recovers an advancement whose successful response was lost", async () => {
    const current = await fixture({ targetAdvance: true });
    const { integrationPlan, candidate, verification } = await prepareVerifiedCandidate(current);
    let firstAdvance = true;
    const base = current.integrationHost;
    const lostResponseHost: WorkspaceIntegrationHostAdapter = {
      kind: base.kind,
      version: base.version,
      capabilities: base.capabilities,
      inspectTarget: (request) => base.inspectTarget(request),
      applyIntegration: (request) => base.applyIntegration(request),
      advanceTarget: async (request) => {
        const result = await base.advanceTarget(request);
        if (firstAdvance) {
          firstAdvance = false;
          throw new Error("response lost after exact ref update");
        }
        return result;
      },
      rollbackTarget: (request) => base.rollbackTarget(request),
      resetCandidate: (request) => base.resetCandidate(request),
    };
    await expect(
      completeWorkspaceIntegration({
        plan: integrationPlan,
        verificationReceipt: verification,
        integrationHost: lostResponseHost,
        now: new Date("2026-08-26T00:00:21Z"),
      }),
    ).resolves.toMatchObject({
      status: "integrated",
      targetAfterCommit: candidate.candidateCommit,
    });
  }, 20_000);

  it("rejects a verification receipt whose content no longer matches its hash", async () => {
    const current = await fixture({ targetAdvance: true });
    const { integrationPlan, verification } = await prepareVerifiedCandidate(current);
    const changedReceipt = {
      ...verification,
      verifiedAt: "2026-08-26T00:00:20.001Z",
    };
    await expect(
      completeWorkspaceIntegration({
        plan: integrationPlan,
        verificationReceipt: changedReceipt,
        integrationHost: current.integrationHost,
        now: new Date("2026-08-26T00:00:21Z"),
      }),
    ).rejects.toMatchObject({ code: "host_coordinate_invalid" });
    expect(await git(current.root, "rev-parse", current.targetRef)).toBe(
      current.targetBeforeCommit,
    );
  }, 20_000);

  it("rolls the target back when the success event cannot commit", async () => {
    const current = await fixture({ targetAdvance: true });
    const { integrationPlan, verification } = await prepareVerifiedCandidate(current);
    const records = await RepositoryCoordinationRecords.open(current.root);
    await records.write({
      collection: "events",
      recordId: integrationPlan.integratedAttemptEventId,
      value: { occupied: true },
      expectedContentHash: null,
    });
    await expect(
      completeWorkspaceIntegration({
        plan: integrationPlan,
        verificationReceipt: verification,
        integrationHost: current.integrationHost,
        now: new Date("2026-08-26T00:00:21Z"),
      }),
    ).rejects.toMatchObject({ code: "coordination_state_conflict" });
    expect(await git(current.root, "rev-parse", current.targetRef)).toBe(
      current.targetBeforeCommit,
    );
    expect(
      (await readWorkspaceIntegrationAttempt(current.root, integrationPlan.attempt.targetLeaseId))!
        .attempt.state,
    ).toBe("candidate");
  }, 20_000);

  it("resumes source projection after the durable integration commit point", async () => {
    const current = await fixture({ targetAdvance: true });
    const { integrationPlan, candidate, verification } = await prepareVerifiedCandidate(current);
    let attempt = await readWorkspaceIntegrationAttempt(
      current.root,
      integrationPlan.attempt.targetLeaseId,
    );
    attempt = await beginWorkspaceIntegrationAdvancement({
      repositoryRoot: current.root,
      targetLeaseId: attempt!.attempt.targetLeaseId,
      expectedContentHash: attempt!.contentHash,
      expectedRevision: attempt!.attempt.revision,
      eventId: integrationPlan.advancingEventId,
      occurredAt: "2026-08-26T00:00:21Z",
      verificationReceiptHash: verification.contentHash,
      verificationResults: verification.results.map(
        ({ suiteId, suiteHash, verificationId, resultArtifactId, resultContentHash }) => ({
          suiteId,
          suiteHash,
          verificationId,
          resultArtifactId,
          resultContentHash,
        }),
      ),
    });
    await current.integrationHost.advanceTarget({
      repositoryRoot: current.root,
      integrationWorkspacePath: current.integrationPath,
      integrationBaseCommit: integrationPlan.integrationBaseCommit,
      integrationMarker: integrationPlan.integrationMarker,
      targetRef: current.targetRef,
      targetBeforeCommit: current.targetBeforeCommit,
      candidateCommit: candidate.candidateCommit!,
      candidateTreeHash: candidate.candidateTreeHash!,
      idempotencyKey: integrationPlan.advanceIdempotencyKey,
    });
    await commitWorkspaceIntegrationAttempt({
      repositoryRoot: current.root,
      targetLeaseId: attempt.attempt.targetLeaseId,
      expectedContentHash: attempt.contentHash,
      expectedRevision: attempt.attempt.revision,
      eventId: integrationPlan.integratedAttemptEventId,
      occurredAt: "2026-08-26T00:00:21Z",
    });
    expect((await readWorkspace(current.root, current.worker.workspaceId))!.workspace.state).toBe(
      "integrating",
    );
    await expect(
      completeWorkspaceIntegration({
        plan: integrationPlan,
        verificationReceipt: verification,
        integrationHost: current.integrationHost,
        now: new Date("2026-08-26T00:00:22Z"),
      }),
    ).resolves.toMatchObject({ status: "integrated" });
    expect((await readWorkspace(current.root, current.worker.workspaceId))!.workspace.state).toBe(
      "integrated",
    );
  }, 20_000);

  it("rejects a stale target before acquiring the integration attempt", async () => {
    const current = await fixture();
    const integrationPlan = await plan(current);
    await writeFile(resolve(current.root, "src/target.ts"), "export const target = true;\n");
    await git(current.root, "add", "src/target.ts");
    await git(current.root, "commit", "-m", "advance target");
    await expect(
      applyWorkspaceIntegrationCandidate({
        plan: integrationPlan,
        integrationHost: current.integrationHost,
        now: new Date("2026-08-26T00:00:17Z"),
      }),
    ).rejects.toMatchObject({ code: "host_effect_uncertain" });
    expect(
      await readWorkspaceIntegrationAttempt(current.root, integrationPlan.attempt.targetLeaseId),
    ).toBeNull();
    expect((await readWorkspace(current.root, current.worker.workspaceId))!.workspace.state).toBe(
      "integration_pending",
    );
  }, 20_000);

  it("aborts a Git conflict exactly and records no target success", async () => {
    const current = await fixture({ conflict: true });
    const integrationPlan = await plan(current);
    const result = await applyWorkspaceIntegrationCandidate({
      plan: integrationPlan,
      integrationHost: current.integrationHost,
      now: new Date("2026-08-26T00:00:17Z"),
    });
    expect(result).toMatchObject({
      status: "conflict",
      operationAborted: true,
      targetUnchanged: true,
      conflictWorkspaceId: current.worker.workspaceId,
    });
    expect(await git(current.root, "rev-parse", targetRef)).toBe(current.targetBeforeCommit);
    expect(await git(current.integrationPath, "rev-parse", "HEAD")).toBe(
      current.targetBeforeCommit,
    );
    expect((await readWorkspace(current.root, current.worker.workspaceId))!.workspace.state).toBe(
      "integration_conflict",
    );
  }, 20_000);
});
