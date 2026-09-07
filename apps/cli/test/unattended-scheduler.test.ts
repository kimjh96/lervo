import { describe, expect, it, vi } from "vitest";

import type { WorkforceAgent, WorkforceAssignment } from "@lervo/agent-workforce";
import type { GovernedWorkReportV1 } from "@lervo/application-contract";

import { createUnattendedSchedulerExecutor } from "../src/unattended-scheduler.js";

const assignmentId = "asn_111111111111111111111111";
const agentId = "agt_111111111111111111111111";
const workstreamId = "wks_111111111111111111111111";

function agent(): WorkforceAgent {
  return {
    schemaVersion: 1,
    agentId,
    projectId: "prj_fixture001",
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"a".repeat(64)}`,
    roleProfileHash: `sha256:${"b".repeat(64)}`,
    provider: "codex",
    capabilityHash: `sha256:${"c".repeat(64)}`,
    skillIds: ["testing"],
    capabilityPackages: [],
    responsibilityPaths: ["src", "docs"],
    parentAgentId: null,
    delegationDepth: 0,
    status: "active",
    revision: 1,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

function assignment(): WorkforceAssignment {
  return {
    schemaVersion: 1,
    assignmentId,
    projectId: "prj_fixture001",
    taskType: "implementation",
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"a".repeat(64)}`,
    requiredCapabilityHash: null,
    status: "queued",
    priority: 50,
    dependencyIds: [],
    acceptanceCriteria: ["Create the scheduled result."],
    verificationSuiteIds: ["project.quick"],
    approvalRequirements: [],
    expectedPaths: ["src/result.ts", "docs/result.md"],
    workstreamId,
    assigneeAgentId: null,
    lease: null,
    handoffs: [],
    resultArtifacts: [],
    failureCode: null,
    revision: 1,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z",
  };
}

function governedReport(current: WorkforceAssignment): GovernedWorkReportV1 {
  const graphHash =
    `sha256:${current.status === "queued" ? "d" : current.status === "leased" ? "e" : "f"}`.padEnd(
      71,
      current.status === "queued" ? "d" : current.status === "leased" ? "e" : "f",
    );
  const action: GovernedWorkReportV1["decision"]["actions"][number] =
    current.status === "queued"
      ? { kind: "claim_assignment", assignmentId, reasonCode: "ready" }
      : current.status === "leased"
        ? {
            kind: "start_attempt",
            assignmentId,
            reasonCode: "ready",
            causality: { relationship: "root", workstreamId, assignmentId, agentId },
          }
        : { kind: "complete_work", assignmentId: null, reasonCode: "all_assignments_completed" };
  return {
    schemaVersion: 1,
    projectId: current.projectId,
    workstreamId,
    graph: {
      schemaVersion: 1,
      graphId: "wgr_111111111111111111111111",
      graphHash,
      projectId: current.projectId,
      workstreamId,
      observedAt: "2026-09-07T00:00:00.000Z",
      validity: { status: "valid", reasonCodes: [] },
      nodes: [
        {
          assignmentId,
          assignmentRevision: current.revision,
          taskType: current.taskType,
          roleId: current.roleId,
          status: current.status,
          priority: current.priority,
          dependencyIds: [],
          approvalRequirementDigests: [],
          leaseState: current.status === "leased" ? "active" : "none",
          assigneeAgentId: current.assigneeAgentId,
          leaseId: current.lease?.leaseId ?? null,
          attemptCount: 0,
        },
      ],
      rootAssignmentIds: [assignmentId],
      joinAssignmentIds: [],
    },
    attempts: [],
    completionEvidence: [],
    resources: [],
    stages: [],
    budgets: [],
    approvals: [],
    policy: {
      schemaVersion: 1,
      maxAttemptsPerAssignment: 2,
      maxParallelAssignments: 1,
      tokenLimits: [],
      tokenMetricLimits: [],
      durationLimits: [],
      unobservedResourceAction: "escalate",
      exhaustedResourceAction: "block",
      terminalFailureAction: "escalate",
    },
    decision: {
      schemaVersion: 1,
      decisionId: `gld_${current.status.padEnd(16, "0")}`,
      graphHash,
      status: current.status === "completed" ? "complete" : "ready",
      actions: [action],
    },
  };
}

function request() {
  return {
    repositoryRoot: "/repository",
    policy: { maxParallelAssignments: 1 },
    provider: "codex" as const,
    eligibleAgentIds: [],
    pollIntervalMs: 100,
    maximumCycles: 4,
    maximumClaims: 1,
    maximumManagedRuns: 1,
    maximumRuntimeMs: 60_000,
    maximumConsecutiveFailures: 2,
    leaseDurationMs: 300_000,
    killSwitchPath: ".lervo/state/unattended-scheduler.stop",
    risk: "medium",
  };
}

describe("unattended scheduler", () => {
  it("claims and completes a queued assignment without another manual trigger", async () => {
    let current = assignment();
    const executeManagedRun = vi.fn(async (input) => {
      expect(input.expectedPaths).toEqual(["src/result.ts", "docs/result.md"]);
      expect(input.instructions).toContain("Create the scheduled result.");
      return {
        runId: "run_111111111111111111111111",
        sessionId: "ses_provider_11111111",
        verificationStatus: "passed" as const,
        writingPublication: { status: "allowed" as const },
        resultArtifact: {
          artifactId: "art_111111111111111111111111",
          contentHash: `sha256:${"f".repeat(64)}`,
        },
      } as never;
    });
    const runtime = {
      schedulerSessionId: "ses_scheduler_11111111111111111111111111111111",
      now: () => new Date("2026-09-07T00:00:00.000Z"),
      sleep: vi.fn(async () => undefined),
      killSwitchEngaged: vi.fn(async () => false),
      release: vi.fn(async () => undefined),
    };
    const execute = createUnattendedSchedulerExecutor({
      inspectGovernedWork: vi.fn(async () => governedReport(current)),
      listAgents: vi.fn(async () => [agent()]),
      listAssignments: vi.fn(async () => [structuredClone(current)]),
      claimAssignment: vi.fn(async (input) => {
        expect(input.expectedRevision).toBe(1);
        current = {
          ...current,
          status: "leased",
          assigneeAgentId: agentId,
          revision: 2,
          lease: {
            leaseId: "lse_111111111111111111111111",
            agentId,
            sessionId: input.sessionId,
            generation: 1,
            acquiredAt: "2026-09-07T00:00:00.000Z",
            expiresAt: "2026-09-07T00:05:00.000Z",
          },
        };
        return current;
      }),
      executeManagedRun,
      finalizeGovernedAssignment: vi.fn(async () => {
        current = { ...current, status: "completed", revision: 3, lease: null };
      }),
      openRuntime: vi.fn(async () => runtime),
    });

    await expect(execute(request())).resolves.toMatchObject({
      status: "completed",
      reasonCode: "work_complete",
      counts: { cycles: 2, claims: 1, managedRuns: 1, completedAssignments: 1 },
    });
    expect(executeManagedRun).toHaveBeenCalledOnce();
    expect(runtime.sleep).not.toHaveBeenCalled();
    expect(runtime.release).toHaveBeenCalledOnce();
  });

  it("honors the kill switch before reading or mutating repository work", async () => {
    const inspectGovernedWork = vi.fn();
    const runtime = {
      schedulerSessionId: "ses_scheduler_11111111111111111111111111111111",
      now: () => new Date("2026-09-07T00:00:00.000Z"),
      sleep: vi.fn(async () => undefined),
      killSwitchEngaged: vi.fn(async () => true),
      release: vi.fn(async () => undefined),
    };
    const execute = createUnattendedSchedulerExecutor({
      inspectGovernedWork,
      listAgents: vi.fn(),
      listAssignments: vi.fn(),
      claimAssignment: vi.fn(),
      executeManagedRun: vi.fn(),
      finalizeGovernedAssignment: vi.fn(),
      openRuntime: vi.fn(async () => runtime),
    });

    await expect(execute(request())).resolves.toMatchObject({
      status: "paused",
      reasonCode: "kill_switch_engaged",
      counts: { cycles: 0, claims: 0, managedRuns: 0 },
    });
    expect(inspectGovernedWork).not.toHaveBeenCalled();
    expect(runtime.release).toHaveBeenCalledOnce();
  });

  it("retries only a known pre-effect admission failure within both limits", async () => {
    let current = assignment();
    const outcome = {
      runId: "run_111111111111111111111111",
      sessionId: "ses_provider_11111111",
      verificationStatus: "passed" as const,
      writingPublication: { status: "allowed" as const },
      resultArtifact: {
        artifactId: "art_111111111111111111111111",
        contentHash: `sha256:${"f".repeat(64)}`,
      },
    } as never;
    const executeManagedRun = vi
      .fn()
      .mockRejectedValueOnce(new Error("admission failed before causal evidence"))
      .mockResolvedValueOnce(outcome);
    const runtime = {
      schedulerSessionId: "ses_scheduler_11111111111111111111111111111111",
      now: () => new Date("2026-09-07T00:00:00.000Z"),
      sleep: vi.fn(async () => undefined),
      killSwitchEngaged: vi.fn(async () => false),
      release: vi.fn(async () => undefined),
    };
    const execute = createUnattendedSchedulerExecutor({
      inspectGovernedWork: vi.fn(async () => governedReport(current)),
      listAgents: vi.fn(async () => [agent()]),
      listAssignments: vi.fn(async () => [structuredClone(current)]),
      claimAssignment: vi.fn(async (input) => {
        current = {
          ...current,
          status: "leased",
          assigneeAgentId: agentId,
          revision: 2,
          lease: {
            leaseId: "lse_111111111111111111111111",
            agentId,
            sessionId: input.sessionId,
            generation: 1,
            acquiredAt: "2026-09-07T00:00:00.000Z",
            expiresAt: "2026-09-07T00:05:00.000Z",
          },
        };
        return current;
      }),
      executeManagedRun,
      finalizeGovernedAssignment: vi.fn(async () => {
        current = { ...current, status: "completed", revision: 3, lease: null };
      }),
      openRuntime: vi.fn(async () => runtime),
    });

    await expect(
      execute({ ...request(), maximumManagedRuns: 2, maximumCycles: 4 }),
    ).resolves.toMatchObject({
      status: "completed",
      counts: { claims: 1, managedRuns: 2, completedAssignments: 1 },
    });
    expect(executeManagedRun).toHaveBeenCalledTimes(2);
    expect(runtime.sleep).toHaveBeenCalledOnce();
  });
});
