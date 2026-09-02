import { describe, expect, it, vi } from "vitest";

import type {
  AssignmentCommunicationReportV1,
  GovernedWorkReportV1,
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
  });

  it("reports exact observed token limits without combining accounting groups", async () => {
    const output = io();
    const value = report();
    value.policy.tokenLimits = [
      {
        provider: "codex",
        accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
        stopAfterObservedTotalTokens: 1500,
      },
    ];
    value.resources = [
      {
        schemaVersion: 1,
        provider: "codex",
        source: "provider_reported",
        accountingMode: "turn_cumulative",
        accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
        completeness: "complete",
        totalTokens: 1200,
        runCount: 1,
        reasonCodes: [],
      },
    ];
    const services = {
      inspectGovernedWork: vi.fn(async () => value),
    } as unknown as CliServices;

    expect(await runLoopCommand(["budget", "--json"], output.value, services)).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toEqual([
      expect.objectContaining({ observedTokens: 1200, remainingObservedTokens: 300 }),
    ]);
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
