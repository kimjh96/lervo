import { describe, expect, it, vi } from "vitest";

import type {
  AssignmentCommunicationReportV1,
  GovernedWorkReportV1,
  OperatingGoalReportV1,
  OperatingObjectiveReportV1,
} from "@lervo/application-contract";

import { runLoopCommand } from "../src/loop-command.js";
import type { CliServices } from "../src/types.js";

const assignmentId = "asn_111111111111111111111111";
const agentId = "agt_111111111111111111111111";
const leaseId = "lse_111111111111111111111111";
const workstreamId = "wks_111111111111111111111111";

function report(): GovernedWorkReportV1 {
  const policy = {
    schemaVersion: 1 as const,
    maxAttemptsPerAssignment: 2,
    maxParallelAssignments: 2,
    tokenLimits: [],
    tokenMetricLimits: [],
    durationLimits: [],
    unobservedResourceAction: "escalate" as const,
    exhaustedResourceAction: "block" as const,
    terminalFailureAction: "escalate" as const,
  };
  return {
    schemaVersion: 1,
    projectId: "prj_fixture001",
    workstreamId,
    graph: {
      schemaVersion: 1,
      graphId: "wgr_111111111111111111111111",
      graphHash: `sha256:${"a".repeat(64)}`,
      projectId: "prj_fixture001",
      workstreamId,
      observedAt: "2026-09-01T00:00:00.000Z",
      validity: { status: "valid", reasonCodes: [] },
      nodes: [
        {
          assignmentId,
          assignmentRevision: 2,
          taskType: "implementation",
          roleId: "developer",
          status: "leased",
          priority: 50,
          dependencyIds: [],
          approvalRequirementDigests: [],
          leaseState: "active",
          assigneeAgentId: agentId,
          leaseId,
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
    policy,
    decision: {
      schemaVersion: 1,
      decisionId: "gld_111111111111111111111111",
      graphHash: `sha256:${"a".repeat(64)}`,
      status: "ready",
      actions: [
        {
          kind: "start_attempt",
          assignmentId,
          reasonCode: "ready",
          causality: { relationship: "root", workstreamId, assignmentId, agentId },
        },
      ],
    },
  };
}

function reconciliationReport(): GovernedWorkReportV1 {
  const value = report();
  const node = value.graph.nodes[0]!;
  const runId = "run_111111111111111111111111";
  value.attempts = [
    {
      schemaVersion: 1,
      assignmentId,
      workId: "wrk_111111111111111111111111",
      runId,
      relationship: "root",
      attemptOrdinal: 1,
      terminalStatus: "completed",
      verificationStatus: "passed",
    },
  ];
  value.completionEvidence = [
    {
      schemaVersion: 1,
      completionEvidenceId: "acp_111111111111111111111111",
      workstreamId,
      assignmentId,
      assignmentRevision: node.assignmentRevision,
      agentId,
      leaseId,
      runId,
      sessionId: "ses_111111111111111111111111",
      resultArtifactId: "art_111111111111111111111111",
      resultContentHash: `sha256:${"b".repeat(64)}`,
      preparedAt: "2026-09-01T00:00:30.000Z",
    },
  ];
  value.decision = {
    schemaVersion: 1,
    decisionId: "gld_222222222222222222222222",
    graphHash: value.graph.graphHash,
    status: "ready",
    actions: [
      {
        kind: "reconcile_completion",
        assignmentId,
        reasonCode: "completion_evidence_verified",
        completionEvidenceId: value.completionEvidence[0]!.completionEvidenceId,
        runId,
      },
    ],
  };
  return value;
}

function objective(): OperatingObjectiveReportV1 {
  return {
    schemaVersion: 1,
    projectId: "prj_fixture001",
    workstreamId,
    workstreamRevision: 7,
    status: "active",
    title: "Current operating objective",
    objective: "Keep evidence and authority separate.",
    nextActions: ["Render the verified board."],
    blockers: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
    observedAt: "2026-09-01T00:01:00.000Z",
  };
}

function communications(): AssignmentCommunicationReportV1 {
  return {
    schemaVersion: 1,
    projectId: "prj_fixture001",
    workstreamId,
    observedAt: "2026-09-01T00:01:00.000Z",
    validity: { status: "valid", reasonCodes: [] },
    threads: [
      {
        schemaVersion: 1,
        threadId: "ath_111111111111111111111111",
        assignmentId,
        assignmentRevision: 2,
        assignmentStatus: "leased",
        routes: [],
      },
    ],
    inbox: [],
    limitations: [],
  };
}

function goal(): OperatingGoalReportV1 {
  return {
    schemaVersion: 1,
    kind: "operating_goal.report",
    projectId: "prj_fixture001",
    observedAt: "2026-09-01T00:01:00.000Z",
    goal: {
      goalId: workstreamId,
      authoritySource: "workstream",
      revision: 7,
      status: "active",
      title: "Current operating objective",
      objective: "Keep evidence and authority separate.",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    hierarchy: { kind: "workstream_assignment_dag", graph: report().graph },
    progress: {
      total: 1,
      queued: 0,
      active: 1,
      blocked: 0,
      failed: 0,
      completed: 0,
      cancelled: 0,
    },
    completion: { status: "active", reasonCodes: [] },
    authority: {
      createsGoal: false,
      changesWorkstream: false,
      changesAssignments: false,
      startsProvider: false,
    },
    limitations: ["Projection only."],
  };
}

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    value: {
      cwd: "/repository",
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
  };
}

describe("loop command", () => {
  it("renders one headless governed-work report", async () => {
    const output = io();
    const services = {
      inspectGovernedWork: vi.fn(async () => report()),
      inspectOperatingObjective: vi.fn(async () => objective()),
      inspectAssignmentCommunications: vi.fn(async () => communications()),
    } as unknown as CliServices;
    expect(await runLoopCommand(["status"], output.value, services)).toBe(0);
    expect(output.stdout.join("")).toContain("start_attempt");
    expect(output.stderr).toEqual([]);
  });

  it("renders the same governed report as a read-only local operating board", async () => {
    const output = io();
    const executeManagedRun = vi.fn();
    const finalizeGovernedAssignment = vi.fn();
    const reconcileGovernedAssignment = vi.fn();
    const services = {
      inspectGovernedWork: vi.fn(async () => report()),
      inspectOperatingObjective: vi.fn(async () => objective()),
      inspectAssignmentCommunications: vi.fn(async () => communications()),
      executeManagedRun,
      finalizeGovernedAssignment,
      reconcileGovernedAssignment,
    } as unknown as CliServices;

    expect(await runLoopCommand(["board"], output.value, services)).toBe(0);
    expect(output.stdout.join("")).toContain("<!doctype html>");
    expect(output.stdout.join("")).toContain("Projection, not authority");
    expect(output.stdout.join("")).toContain(assignmentId);
    expect(output.stdout.join("")).toContain("Current operating objective");
    expect(output.stderr).toEqual([]);
    expect(executeManagedRun).not.toHaveBeenCalled();
    expect(finalizeGovernedAssignment).not.toHaveBeenCalled();
    expect(reconcileGovernedAssignment).not.toHaveBeenCalled();
  });

  it("renders an invalid governed report while preserving its nonzero status", async () => {
    const output = io();
    const invalid = report();
    invalid.graph.validity = { status: "invalid", reasonCodes: ["dependency_cycle"] };
    invalid.decision = {
      schemaVersion: 1,
      decisionId: "gld_333333333333333333333333",
      graphHash: invalid.graph.graphHash,
      status: "invalid",
      actions: [{ kind: "escalate", assignmentId: null, reasonCode: "graph_invalid" }],
    };
    const services = {
      inspectGovernedWork: vi.fn(async () => invalid),
      inspectOperatingObjective: vi.fn(async () => objective()),
      inspectAssignmentCommunications: vi.fn(async () => communications()),
    } as unknown as CliServices;

    expect(await runLoopCommand(["board"], output.value, services)).toBe(1);
    expect(output.stdout.join("")).toContain("dependency_cycle");
    expect(output.stdout.join("")).toContain("graph_invalid");
    expect(output.stderr).toEqual([]);
  });

  it("renders the verified current objective without inspecting managed work", async () => {
    const output = io();
    const inspectGovernedWork = vi.fn();
    const services = {
      inspectOperatingObjective: vi.fn(async () => objective()),
      inspectGovernedWork,
    } as unknown as CliServices;

    expect(await runLoopCommand(["objective"], output.value, services)).toBe(0);
    expect(output.stdout.join("")).toContain("Keep evidence and authority separate.");
    expect(inspectGovernedWork).not.toHaveBeenCalled();
  });

  it("renders the composed goal lifecycle without starting managed work", async () => {
    const output = io();
    const executeManagedRun = vi.fn();
    const services = {
      inspectOperatingGoal: vi.fn(async () => goal()),
      executeManagedRun,
    } as unknown as CliServices;

    expect(await runLoopCommand(["goal", "--json"], output.value, services)).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({
      kind: "operating_goal.report",
      completion: { status: "active" },
      authority: { createsGoal: false, startsProvider: false },
    });
    expect(executeManagedRun).not.toHaveBeenCalled();
  });

  it("reads assignment threads and inboxes without inspecting governed work", async () => {
    const threadOutput = io();
    const inboxOutput = io();
    const inspectGovernedWork = vi.fn();
    const inspectAssignmentCommunications = vi.fn(async () => communications());
    const services = {
      inspectGovernedWork,
      inspectAssignmentCommunications,
    } as unknown as CliServices;

    expect(
      await runLoopCommand(["thread", "--assignment", assignmentId], threadOutput.value, services),
    ).toBe(0);
    expect(await runLoopCommand(["inbox", "--agent", agentId], inboxOutput.value, services)).toBe(
      0,
    );
    expect(
      await runLoopCommand(
        ["thread", "--contract", "2", "--assignment", assignmentId],
        threadOutput.value,
        services,
      ),
    ).toBe(0);
    expect(threadOutput.stdout.join("")).toContain("Assignment threads");
    expect(inboxOutput.stdout.join("")).toContain("Assignment inbox");
    expect(inspectGovernedWork).not.toHaveBeenCalled();
    expect(inspectAssignmentCommunications).toHaveBeenNthCalledWith(1, {
      repositoryRoot: "/repository",
      assignmentId,
    });
    expect(inspectAssignmentCommunications).toHaveBeenNthCalledWith(2, {
      repositoryRoot: "/repository",
      recipientAgentId: agentId,
    });
    expect(inspectAssignmentCommunications).toHaveBeenNthCalledWith(3, {
      repositoryRoot: "/repository",
      assignmentId,
      contractVersion: 2,
    });
  });

  it("reports exact observed token limits without combining accounting groups", async () => {
    const output = io();
    const value = report();
    value.policy.tokenLimits = [
      {
        provider: "codex",
        scope: "primary_provider",
        accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
        stopAfterObservedTotalTokens: 1500,
      },
    ];
    value.resources = [
      {
        schemaVersion: 1,
        provider: "codex",
        scope: "primary_provider",
        source: "provider_reported",
        accountingMode: "turn_cumulative",
        accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
        completeness: "complete",
        tokenUsage: {
          inputTokens: 1000,
          cachedInputTokens: 200,
          outputTokens: 200,
          reasoningOutputTokens: 0,
          totalTokens: 1200,
        },
        totalTokens: 1200,
        runCount: 1,
        reasonCodes: [],
      },
    ];
    value.budgets = [
      {
        schemaVersion: 1,
        kind: "token",
        provider: "codex",
        scope: "primary_provider",
        accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
        metric: "total_tokens",
        limitTokens: 1500,
        observedTokens: 1200,
        remainingObservedTokens: 300,
        completeness: "complete",
        thresholdState: "below",
      },
    ];
    const services = {
      inspectGovernedWork: vi.fn(async () => value),
    } as unknown as CliServices;

    expect(
      await runLoopCommand(
        [
          "budget",
          "--token-limit",
          `codex:primary_provider:sha256:${"d".repeat(64)}:1500`,
          "--json",
        ],
        output.value,
        services,
      ),
    ).toBe(0);
    expect(services.inspectGovernedWork).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({
          tokenLimits: [expect.objectContaining({ scope: "primary_provider" })],
        }),
      }),
    );
    expect(JSON.parse(output.stdout.join(""))).toEqual([
      expect.objectContaining({ observedTokens: 1200, remainingObservedTokens: 300 }),
    ]);
  });

  it("returns failure for a reached managed duration budget", async () => {
    const output = io();
    const value = report();
    value.budgets = [
      {
        schemaVersion: 1,
        kind: "duration",
        provider: "codex",
        scope: "primary_provider",
        stageId: "provider_turn",
        limitDurationMs: 1000,
        maximumObservedDurationMs: 1000,
        remainingObservedDurationMs: 0,
        observationCount: 1,
        completeness: "complete",
        thresholdState: "reached",
      },
    ];
    const services = {
      inspectGovernedWork: vi.fn(async () => value),
    } as unknown as CliServices;

    expect(
      await runLoopCommand(
        ["budget", "--duration-limit", "codex:primary_provider:provider_turn:1000", "--json"],
        output.value,
        services,
      ),
    ).toBe(1);
    expect(services.inspectGovernedWork).toHaveBeenCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({
          durationLimits: [
            expect.objectContaining({
              stageId: "provider_turn",
              stopAfterObservedDurationMs: 1000,
            }),
          ],
        }),
      }),
    );
  });

  it("executes through the managed-run port and finalizes only after accepted output", async () => {
    const output = io();
    const executeManagedRun = vi.fn(async () => ({
      runId: "run_111111111111111111111111",
      sessionId: "ses_111111111111111111111111",
      verificationStatus: "passed",
      writingPublication: { status: "allowed" },
      resultArtifact: {
        artifactId: "art_111111111111111111111111",
        contentHash: `sha256:${"b".repeat(64)}`,
      },
    }));
    const finalizeGovernedAssignment = vi.fn(async () => undefined);
    const services = {
      inspectGovernedWork: vi.fn(async () => report()),
      executeManagedRun,
      finalizeGovernedAssignment,
    } as unknown as CliServices;
    const status = await runLoopCommand(
      [
        "run",
        "--provider",
        "codex",
        "--assignment",
        assignmentId,
        "--agent",
        agentId,
        "--lease",
        leaseId,
        "--path",
        "src/example.ts",
        "--verification",
        "project.quick",
        "Implement the bounded task.",
      ],
      output.value,
      services,
    );
    expect(status).toBe(0);
    expect(executeManagedRun).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentFinalization: "governed",
        workCausality: { relationship: "root", workstreamId, assignmentId, agentId },
      }),
    );
    expect(finalizeGovernedAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId, verificationStatus: "passed" }),
    );
  });

  it("fails assignment finalization when a successful run reaches an observed token budget", async () => {
    const output = io();
    const before = report();
    const after = report();
    after.decision = {
      schemaVersion: 1,
      decisionId: "gld_333333333333333333333333",
      graphHash: after.graph.graphHash,
      status: "blocked",
      actions: [{ kind: "block", assignmentId: null, reasonCode: "token_budget_exhausted" }],
    };
    const executeManagedRun = vi.fn(async () => ({
      runId: "run_111111111111111111111111",
      sessionId: "ses_111111111111111111111111",
      verificationStatus: "passed",
      writingPublication: { status: "allowed" },
      resultArtifact: {
        artifactId: "art_111111111111111111111111",
        contentHash: `sha256:${"b".repeat(64)}`,
      },
    }));
    const finalizeGovernedAssignment = vi.fn(async () => undefined);
    const services = {
      inspectGovernedWork: vi
        .fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
      executeManagedRun,
      finalizeGovernedAssignment,
    } as unknown as CliServices;

    expect(
      await runLoopCommand(
        [
          "run",
          "--provider",
          "codex",
          "--assignment",
          assignmentId,
          "--agent",
          agentId,
          "--lease",
          leaseId,
          "--path",
          "src/example.ts",
          "--verification",
          "project.quick",
          "--token-metric-limit",
          `codex:primary_provider:sha256:${"d".repeat(64)}:cached_input_tokens:100`,
          "Implement the bounded task.",
        ],
        output.value,
        services,
      ),
    ).toBe(1);
    expect(finalizeGovernedAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentId,
        verificationStatus: "failed",
        failureCode: "token_budget_exhausted",
      }),
    );
    expect(output.stderr.join("")).toContain("token_budget_exhausted");
  });

  it("does not fail an assignment when provider admission recorded no new attempt", async () => {
    const output = io();
    const finalizeGovernedAssignment = vi.fn(async () => undefined);
    const services = {
      inspectGovernedWork: vi.fn(async () => report()),
      executeManagedRun: vi.fn(async () => {
        throw new Error("provider admission failed");
      }),
      finalizeGovernedAssignment,
    } as unknown as CliServices;
    const status = await runLoopCommand(
      [
        "run",
        "--provider",
        "codex",
        "--assignment",
        assignmentId,
        "--agent",
        agentId,
        "--lease",
        leaseId,
        "--path",
        "src/example.ts",
        "--verification",
        "project.quick",
        "Implement the bounded task.",
      ],
      output.value,
      services,
    );
    expect(status).toBe(1);
    expect(finalizeGovernedAssignment).not.toHaveBeenCalled();
    expect(output.stderr.join("")).toContain("retry=false");
  });

  it("plans and explicitly applies exact completion reconciliation without provider execution", async () => {
    const plannedOutput = io();
    const reconcileGovernedAssignment = vi.fn(async () => undefined);
    const services = {
      inspectGovernedWork: vi.fn(async () => reconciliationReport()),
      reconcileGovernedAssignment,
    } as unknown as CliServices;
    expect(
      await runLoopCommand(
        ["reconcile", "--assignment", assignmentId, "--json"],
        plannedOutput.value,
        services,
      ),
    ).toBe(0);
    const plan = JSON.parse(plannedOutput.stdout.join("")) as { commandId: string };
    expect(plan.commandId).toMatch(/^gcr_[a-f0-9]{24}$/u);
    expect(reconcileGovernedAssignment).not.toHaveBeenCalled();

    const appliedOutput = io();
    expect(
      await runLoopCommand(
        ["reconcile", "--assignment", assignmentId, "--apply", plan.commandId, "--write", "--json"],
        appliedOutput.value,
        services,
      ),
    ).toBe(0);
    expect(reconcileGovernedAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({ commandId: plan.commandId, assignmentId }),
      }),
    );

    const staleOutput = io();
    const stale = reconciliationReport();
    stale.graph.graphHash = `sha256:${"c".repeat(64)}`;
    stale.decision.graphHash = stale.graph.graphHash;
    const rejectStale = vi.fn(async () => undefined);
    const staleServices = {
      inspectGovernedWork: vi
        .fn()
        .mockResolvedValueOnce(reconciliationReport())
        .mockResolvedValueOnce(stale),
      reconcileGovernedAssignment: rejectStale,
    } as unknown as CliServices;
    expect(
      await runLoopCommand(
        ["reconcile", "--assignment", assignmentId, "--apply", plan.commandId, "--write"],
        staleOutput.value,
        staleServices,
      ),
    ).toBe(1);
    expect(rejectStale).not.toHaveBeenCalled();
    expect(staleOutput.stderr.join("")).toContain("became stale");
  });
});
