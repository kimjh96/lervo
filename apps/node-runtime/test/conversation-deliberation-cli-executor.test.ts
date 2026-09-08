import { describe, expect, it, vi } from "vitest";

import {
  createConversationDeliberationCliExecutionPorts,
  type ConversationDeliberationCliProcess,
} from "../src/conversation-deliberation-cli-executor.js";

describe("conversation deliberation CLI executor", () => {
  it("keeps topic bytes on stdin and preserves the queue-assigned identity", async () => {
    const run = vi.fn<ConversationDeliberationCliProcess["run"]>(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        deliberationId: "dlb_queue0001",
        status: "converged",
        artifactCount: 4,
      }),
      stderr: "",
    }));
    const ports = createConversationDeliberationCliExecutionPorts({
      executable: "/opt/lervo/bin/lervo",
      repositoryRoot: "/srv/project",
      processTimeoutMs: 120_000,
      process: { run },
    });
    await expect(
      ports.start.execute({
        operation: "start",
        projectId: "prj_control01",
        sourceEventId: `cve_${"a".repeat(64)}`,
        deliberationId: "dlb_queue0001",
        requestHash: `sha256:${"b".repeat(64)}`,
        principalHash: `sha256:${"c".repeat(64)}`,
        policyId: "deliberation_product-review",
        topic: "Review a private design proposal.",
        requestedAt: "2026-09-09T00:00:00.000Z",
        state: "leased",
        attemptCount: 1,
        leaseExpiresAt: "2026-09-09T00:05:00.000Z",
        summary: null,
        failureCode: null,
        reconciliation: null,
      }),
    ).resolves.toEqual({
      deliberationId: "dlb_queue0001",
      status: "converged",
      artifactCount: 4,
      nextAction: "none",
    });
    expect(run).toHaveBeenCalledWith({
      executable: "/opt/lervo/bin/lervo",
      args: [
        "deliberate",
        "assigned-worker",
        "--deliberation-id",
        "dlb_queue0001",
        "--project-id",
        "prj_control01",
        "--root",
        "/srv/project",
        "--stdin",
      ],
      stdin: JSON.stringify({
        operation: "start",
        policyId: "deliberation_product-review",
        topic: "Review a private design proposal.",
      }),
      timeoutMs: 120_000,
    });
    expect(run.mock.calls[0]![0].args.join(" ")).not.toContain("private design");
  });

  it("rejects mismatched or non-terminal subprocess evidence", async () => {
    const ports = createConversationDeliberationCliExecutionPorts({
      executable: "/opt/lervo/bin/lervo",
      repositoryRoot: "/srv/project",
      process: {
        run: async () => ({
          exitCode: 0,
          stdout: JSON.stringify({
            schemaVersion: 1,
            deliberationId: "dlb_other0001",
            status: "running",
            artifactCount: 0,
          }),
          stderr: "",
        }),
      },
    });
    await expect(
      ports.resume.execute({
        operation: "resume",
        projectId: "prj_control01",
        sourceEventId: `cve_${"a".repeat(64)}`,
        deliberationId: "dlb_queue0001",
        requestHash: `sha256:${"b".repeat(64)}`,
        principalHash: `sha256:${"c".repeat(64)}`,
        requestedAt: "2026-09-09T00:00:00.000Z",
        state: "leased",
        attemptCount: 1,
        leaseExpiresAt: "2026-09-09T00:05:00.000Z",
        summary: null,
        failureCode: null,
        reconciliation: null,
      }),
    ).rejects.toThrow("invalid evidence");
  });

  it("reconciles uncertain execution only from matching canonical inspection", async () => {
    const run = vi.fn<ConversationDeliberationCliProcess["run"]>(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        projectId: "prj_control01",
        deliberationId: "dlb_queue0001",
        sourceStatus: "consistent",
        phase: "completed",
        completionStatus: "converged",
        artifactCount: 4,
        checkpoint: "readable",
        lease: "missing",
        resume: "completed",
      }),
      stderr: "",
    }));
    const ports = createConversationDeliberationCliExecutionPorts({
      executable: "/opt/lervo/bin/lervo",
      repositoryRoot: "/srv/project",
      process: { run },
    });
    await expect(
      ports.reconciliation.inspect({
        inspectedAt: "2026-09-09T00:01:00.000Z",
        job: {
          operation: "start",
          projectId: "prj_control01",
          deliberationId: "dlb_queue0001",
          requestHash: `sha256:${"b".repeat(64)}`,
          state: "uncertain",
          summary: null,
        },
      }),
    ).resolves.toMatchObject({
      status: "confirmed",
      sourceKind: "managed_deliberation_cli_v1",
      summary: { status: "converged", artifactCount: 4 },
    });
    expect(run).toHaveBeenCalledWith({
      executable: "/opt/lervo/bin/lervo",
      args: ["deliberate", "status", "dlb_queue0001", "--root", "/srv/project", "--json"],
      stdin: "",
      timeoutMs: 60_000,
    });
  });

  it("does not convert incomplete canonical history into a terminal result", async () => {
    const ports = createConversationDeliberationCliExecutionPorts({
      executable: "/opt/lervo/bin/lervo",
      repositoryRoot: "/srv/project",
      process: {
        run: async () => ({
          exitCode: 1,
          stdout: JSON.stringify({
            schemaVersion: 1,
            projectId: "prj_control01",
            deliberationId: "dlb_queue0001",
            sourceStatus: "incomplete",
            phase: "rounds",
            completionStatus: null,
            artifactCount: 1,
            checkpoint: "missing",
            lease: "missing",
            resume: "not_available",
          }),
          stderr: "",
        }),
      },
    });
    await expect(
      ports.reconciliation.inspect({
        inspectedAt: "2026-09-09T00:01:00.000Z",
        job: {
          operation: "start",
          projectId: "prj_control01",
          deliberationId: "dlb_queue0001",
          requestHash: `sha256:${"b".repeat(64)}`,
          state: "uncertain",
          summary: null,
        },
      }),
    ).resolves.toEqual({ status: "not_confirmed", reason: "history_incomplete" });
  });
});
