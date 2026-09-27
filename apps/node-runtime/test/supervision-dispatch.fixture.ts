import { randomBytes } from "node:crypto";
import { openProjectStorage } from "@lervo/project-storage";
import type { OperatingActionKind } from "@lervo/application-contract";
import type { VerificationSuite } from "@lervo/schemas";
import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import { verificationSuiteHash } from "@lervo/verification";
import {
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
} from "@lervo/repository-knowledge";
import { operatingContractHash, workerReadinessKinds } from "@lervo/work-controller";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createAssignment, claimAssignment, registerAgent } from "@lervo/agent-workforce";
import { planWorkspaceProvision, applyWorkspaceProvision } from "@lervo/orchestrator";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { responsibility } from "../../../packages/work-controller/test/operating-supervision.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { recordResponsibilityFixture } from "./supervision-responsibility.fixture.js";

export async function dispatchFixture(
  roots: string[],
  bindResponsibility = true,
  prepareTrackedContext?: (root: string) => Promise<string[]>,
  roleId = "developer",
  actionKinds?: OperatingActionKind[],
  taskContract?: {
    suite: VerificationSuite;
    requiredCapabilities: string[];
    taskPurpose: string;
    workerRoleId?: string;
    maximumAttemptTokens?: number;
  },
  leaseDurationMs?: number,
  completionDeadlineMs?: number,
) {
  const login = await createLoginFixture(roots);
  const suites =
    taskContract === undefined
      ? responsibility().verificationSuiteIds.map((suiteId) => ({
          schemaVersion: 1 as const,
          suiteId,
          stopOnFailure: true as const,
          commands: [
            {
              commandId: "fixture-check",
              executable: "node",
              arguments: ["--version"],
              cwd: ".",
              timeoutMs: 1000,
              maxOutputBytes: 1024,
              environmentVariableNames: [],
            },
          ],
        }))
      : [taskContract.suite];
  const execute = promisify(execFile);
  const f = await supervisionFixture(
    roots,
    async (root) => {
      await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
      for (const suite of suites)
        await writeFile(
          resolve(root, `.lervo/verifications/${suite.suiteId}.yaml`),
          JSON.stringify(suite),
        );
      await mkdir(resolve(root, "src"));
      await writeFile(resolve(root, "src/save.ts"), "export const saved = true;\n");
      const contextPaths = (await prepareTrackedContext?.(root)) ?? [];
      for (const args of [
        ["init"],
        ["config", "user.name", "Lervo Test"],
        ["config", "user.email", "test@example.invalid"],
        ["add", "src", ...contextPaths],
        ["commit", "-m", "fixture"],
      ])
        await execute("git", ["-C", root, ...args]);
    },
    roleId,
    actionKinds,
    taskContract?.workerRoleId === undefined ? undefined : [roleId, taskContract.workerRoleId],
    undefined,
    taskContract === undefined
      ? undefined
      : {
          capabilityCeiling: taskContract.requiredCapabilities,
          ...(taskContract.maximumAttemptTokens === undefined
            ? {}
            : { maximumAttemptTokens: taskContract.maximumAttemptTokens }),
        },
  );
  const worker =
    taskContract?.workerRoleId === undefined
      ? f.owner
      : await registerAgent({
          repositoryRoot: f.root,
          roleId: taskContract.workerRoleId,
          provider: "codex",
          parentAgentId: f.owner.agentId,
          responsibilityPaths: ["src"],
        });
  const recordEvent: NonNullable<Parameters<typeof createAssignment>[0]["recordEvent"]> = async (
    event,
  ) => {
    const storage = await openProjectStorage(f.root);
    try {
      storage.events.append({
        eventId: `evt_${randomBytes(16).toString("hex")}`,
        projectId: storage.manifest.projectId,
        runId: "run_fixture_claim",
        sessionId: "ses_supervision_dispatch",
        type: event.type,
        schemaVersion: 3,
        occurredAt: event.occurredAt,
        actor: { kind: "system" },
        policyVersion: f.binding.mandateHash,
        payload: event.payload,
      });
    } finally {
      await storage.close();
    }
  };
  const created = await createAssignment({
    recordEvent,
    repositoryRoot: f.root,
    taskType: "implementation",
    roleId: worker.roleId,
    workstreamId: f.binding.workstreamId,
    acceptanceCriteria: responsibility().acceptanceCriteria,
    verificationSuiteIds: suites.map((suite) => suite.suiteId),
    expectedPaths: ["src"],
  });
  const assignment = await claimAssignment({
    repositoryRoot: f.root,
    assignmentId: created.assignmentId,
    agentId: worker.agentId,
    sessionId: "ses_supervision_dispatch",
    ...(leaseDurationMs === undefined ? {} : { leaseDurationMs }),
    recordEvent,
  });
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-supervision-worker-"));
  roots.push(parent);
  const workspacePath = resolve(parent, "worker");
  const host = new GitWorkspaceHostAdapter();
  const baseCommit = (await execute("git", ["-C", f.root, "rev-parse", "HEAD"])).stdout.trim();
  const provision = await planWorkspaceProvision({
    repositoryRoot: f.root,
    workspacePath,
    assignmentId: assignment.assignmentId,
    agentId: worker.agentId,
    leaseId: assignment.lease!.leaseId,
    provider: "codex",
    baseCommit,
    integrationTargetDigest: operatingContractHash("fixture"),
    executionKind: "worker",
    host,
  });
  const workspace = await applyWorkspaceProvision({ plan: provision, host });
  const task = {
    ...responsibility(),
    assignmentId: assignment.assignmentId,
    assignmentRevision: assignment.revision,
    executorAgentId: worker.agentId,
    reviewerAgentId: f.owner.agentId,
    roleId: worker.roleId,
    roleVersion: worker.roleVersion,
    roleContractHash: worker.roleContractHash,
    requiredCapabilities: taskContract?.requiredCapabilities ?? ["filesystem.write"],
    verificationSuiteIds: suites.map((suite) => suite.suiteId),
    taskPurpose: taskContract?.taskPurpose ?? responsibility().taskPurpose,
    startDeadline: new Date(
      Date.now() + Math.min(300_000, Math.floor((completionDeadlineMs ?? 1200_000) / 3)),
    ).toISOString(),
    progressDeadline: new Date(
      Date.now() + Math.min(600_000, Math.floor(((completionDeadlineMs ?? 1200_000) * 2) / 3)),
    ).toISOString(),
    completionDeadline: new Date(Date.now() + (completionDeadlineMs ?? 1200_000)).toISOString(),
  };
  const responsibilityHash = operatingContractHash(task);
  if (bindResponsibility)
    await recordResponsibilityFixture({
      ...f,
      workstreamRevision: f.observation.workstreamRevision,
      causationEventIds: f.observation.causationEventIds,
      responsibility: task,
    });
  f.observation.assignments = [
    {
      assignmentId: task.assignmentId,
      revision: task.assignmentRevision,
      executorAgentId: task.executorAgentId,
      acceptanceOwnerAgentId: task.reviewerAgentId,
      responsibilityArtifactHash: responsibilityHash,
      status: "queued",
      dispatchedAt: null,
      startedAt: null,
      startDeadline: task.startDeadline,
      progressDeadline: task.progressDeadline,
      completionDeadline: task.completionDeadline,
      terminalEventId: null,
      effectDisposition: "not_started",
      recoveryDecisionCount: 0,
      artifactHashes: [],
      requiredVerificationSuiteIds: task.verificationSuiteIds,
      verification: [],
      review: null,
      acceptanceHash: operatingContractHash(task.acceptanceCriteria),
    },
  ];
  const propose = f.ports.propose;
  f.ports.propose = async (report) => ({
    ...(await propose(report))!,
    actionKind: "dispatch",
    effectContract: "fixture.dispatch.v1",
    responsibilityArtifactHash: responsibilityHash,
    requiredCapabilities: task.requiredCapabilities,
  });
  const readAdmission = f.ports.readAdmission;
  f.ports.readAdmission = async (plan) => ({
    ...(await readAdmission(plan)),
    effectMappings: [{ actionKind: "dispatch", contract: "fixture.dispatch.v1" }],
  });
  let readinessReads = 0;
  f.ports.readWorkerReadiness = async () => {
    readinessReads++;
    return {
      responsibility: structuredClone(task),
      requiredChecks: [],
      observation: {
        schemaVersion: 1,
        sourceRevisionDigest: f.observation.sourceRevisionDigest,
        responsibilityArtifactHash: responsibilityHash,
        agentId: task.executorAgentId,
        roleId: task.roleId,
        roleVersion: task.roleVersion,
        roleContractHash: task.roleContractHash,
        observedAt: f.ports.now(),
        validUntil: new Date(Date.parse(f.ports.now()) + 30_000).toISOString(),
        checks: workerReadinessKinds.map((kind) => ({
          kind,
          status: "passed",
          evidenceHash: responsibilityHash,
        })),
      },
    };
  };
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: f.root }),
    new Date(),
    () => undefined,
  );
  const runtimeReadiness = {
    verificationSuiteHashes: Object.fromEntries(
      suites.map((suite) => [suite.suiteId, verificationSuiteHash(suite)]),
    ),
    workerWorkspace: {
      parentDirectory: await realpath(parent),
      baseCommit,
      integrationTargetDigest: operatingContractHash("fixture"),
    },
    providerExecutables: { codex: login.executable },
    providerLoginContexts: { codex: login.context },
    verificationTools: Object.fromEntries(
      task.verificationSuiteIds.map((id) => [
        id,
        [{ toolId: "node", executable: process.execPath }],
      ]),
    ),
  };
  return {
    ...f,
    task,
    assignment,
    workspace,
    provision,
    workspacePath,
    runtimeReadiness,
    login,
    suites,
    readinessReads: () => readinessReads,
  };
}
