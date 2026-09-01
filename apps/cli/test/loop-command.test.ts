import { describe, expect, it, vi } from "vitest";

import type { GovernedWorkReportV1 } from "@lervo/application-contract";

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
    resources: [],
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
    } as unknown as CliServices;
    expect(await runLoopCommand(["status"], output.value, services)).toBe(0);
    expect(output.stdout.join("")).toContain("start_attempt");
    expect(output.stderr).toEqual([]);
  });

  it("executes through the managed-run port and finalizes only after accepted output", async () => {
    const output = io();
    const executeManagedRun = vi.fn(async () => ({
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
});
