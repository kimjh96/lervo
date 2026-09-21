import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createConversationDeliberationCliExecutionPorts,
  type ConversationDeliberationCliProcess,
} from "../src/conversation-deliberation-cli-executor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("conversation deliberation CLI executor", () => {
  it("launches an env-node CLI when the service PATH omits the private Node runtime", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-deliberation-cli-"));
    temporaryDirectories.push(root);
    const executable = resolve(root, "lervo-fixture");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const id = process.argv[process.argv.indexOf("--deliberation-id") + 1];
process.stdin.resume();
process.stdin.on("end", () => process.stdout.write(JSON.stringify({schemaVersion: 1, deliberationId: id, status: "converged", artifactCount: 1}) + "\\n"));
`,
    );
    await chmod(executable, 0o700);
    vi.stubEnv("PATH", "/service-path-without-node");
    const ports = createConversationDeliberationCliExecutionPorts({
      executable,
      repositoryRoot: root,
    });

    await expect(
      ports.start.execute({
        operation: "start",
        projectId: "prj_control01",
        sourceEventId: `cve_${"a".repeat(64)}`,
        deliberationId: "dlb_queue0001",
        requestHash: `sha256:${"b".repeat(64)}`,
        principalHash: `sha256:${"c".repeat(64)}`,
        origin: {
          conversationId: "cnv_control01",
          threadId: null,
          requesterParticipantId: "ptc_control01",
          originBindingDigest: `sha256:${"d".repeat(64)}`,
        },
        policyId: "deliberation_product-review",
        topic: "Review the product boundary.",
        requestedAt: "2026-09-09T00:00:00.000Z",
        state: "leased",
        attemptCount: 1,
        leaseExpiresAt: "2026-09-09T00:05:00.000Z",
        summary: null,
        failureCode: null,
        reconciliation: null,
      }),
    ).resolves.toMatchObject({ status: "converged", artifactCount: 1 });
  });

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
      providerExecutables: {
        codex: "/opt/providers/codex",
        claude: "/opt/providers/claude",
      },
      providerModels: { codex: "gpt-test", claude: "claude-test" },
      providerReasoningEfforts: { codex: "high", claude: "medium" },
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
        origin: {
          conversationId: "cnv_control01",
          threadId: null,
          requesterParticipantId: "ptc_control01",
          originBindingDigest: `sha256:${"d".repeat(64)}`,
        },
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
        "--codex-executable",
        "/opt/providers/codex",
        "--claude-executable",
        "/opt/providers/claude",
        "--codex-model",
        "gpt-test",
        "--claude-model",
        "claude-test",
        "--codex-reasoning-effort",
        "high",
        "--claude-reasoning-effort",
        "medium",
        "--stdin",
      ],
      stdin: JSON.stringify({
        operation: "start",
        policyId: "deliberation_product-review",
        topic: "Review a private design proposal.",
        origin: {
          sourceEventId: `cve_${"a".repeat(64)}`,
          conversationId: "cnv_control01",
          threadId: null,
          requesterParticipantId: "ptc_control01",
          originBindingDigest: `sha256:${"d".repeat(64)}`,
        },
        responseLanguage: "en",
        executionMaximumElapsedMs: 60_000,
      }),
      timeoutMs: 120_000,
    });
    expect(run.mock.calls[0]![0].args.join(" ")).not.toContain("private design");
  });

  it("passes exact accepted participant assignments on both start and resume", async () => {
    const run = vi.fn<ConversationDeliberationCliProcess["run"]>(async (request) => ({
      exitCode: 0,
      stdout: JSON.stringify({
        schemaVersion: 1,
        deliberationId: request.args[request.args.indexOf("--deliberation-id") + 1],
        status: "converged",
        artifactCount: 1,
      }),
      stderr: "",
    }));
    const assign = vi.fn(
      (input: {
        deliberationId: string;
        policyId: string | null;
        projectId: string;
        conversationId: string | null;
        acceptedAt: string;
      }) => [
        {
          schemaVersion: 1 as const,
          participationAssignmentId: `dpa_${"1".repeat(40)}`,
          deliberationId: input.deliberationId,
          policyId: "deliberation_product-review",
          policyRoleId: "product-owner",
          projectId: input.projectId,
          conversationId: input.conversationId ?? "cnv_control01",
          organizationId: "org_lervoowner01",
          teamId: "team_project001",
          channelMembershipId: "cmem_lervoagent01",
          membershipId: "amem_lervoagent01",
          deploymentId: "adep_lervoagent01",
          agentId: `agt_${"2".repeat(24)}`,
          participantId: "ptc_lervoagent01",
          agentRoleId: "product-owner",
          roleVersion: "1.0.0",
          roleContractHash: `sha256:${"3".repeat(64)}`,
          roleProfileHash: `sha256:${"4".repeat(64)}`,
          providerPolicyHash: `sha256:${"5".repeat(64)}`,
          provider: "codex" as const,
          model: "gpt-6-astra",
          reasoningEffort: "high" as const,
          executionRouteHash: `sha256:${"6".repeat(64)}`,
          acceptedAt: input.acceptedAt,
        },
      ],
    );
    const ports = createConversationDeliberationCliExecutionPorts({
      executable: "/opt/lervo/bin/lervo",
      repositoryRoot: "/srv/project",
      process: { run },
      participantAssignments: {
        preflight: () => ({ participantIds: ["ptc_lervoagent01"] }),
        assign,
        attach: () => () => undefined,
        publish: async () => undefined,
      },
    });
    const shared = {
      projectId: "prj_control01",
      sourceEventId: `cve_${"a".repeat(64)}`,
      deliberationId: "dlb_queue0001",
      requestHash: `sha256:${"b".repeat(64)}`,
      principalHash: `sha256:${"c".repeat(64)}`,
      requestedAt: "2026-09-09T00:00:00.000Z",
      state: "leased" as const,
      attemptCount: 1,
      leaseExpiresAt: "2026-09-09T00:05:00.000Z",
      summary: null,
      failureCode: null,
      reconciliation: null,
    };
    await ports.start.execute({
      ...shared,
      operation: "start",
      origin: {
        conversationId: "cnv_control01",
        threadId: null,
        requesterParticipantId: "ptc_control01",
        originBindingDigest: `sha256:${"d".repeat(64)}`,
      },
      policyId: "deliberation_product-review",
      topic: "Review the participant route.",
    });
    await ports.resume.execute({ ...shared, operation: "resume" });

    expect(assign).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        deliberationId: "dlb_queue0001",
        policyId: "deliberation_product-review",
        projectId: "prj_control01",
        conversationId: "cnv_control01",
      }),
    );
    expect(assign).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        deliberationId: "dlb_queue0001",
        policyId: null,
        projectId: "prj_control01",
        conversationId: null,
      }),
    );
    const startPayload = JSON.parse(run.mock.calls[0]![0].stdin) as Record<string, unknown>;
    const resumePayload = JSON.parse(run.mock.calls[1]![0].stdin) as Record<string, unknown>;
    expect(startPayload.participantAssignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ participantId: "ptc_lervoagent01" })]),
    );
    expect(resumePayload.participantAssignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ participantId: "ptc_lervoagent01" })]),
    );
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

  it("settles a canonically failed child as a terminal result", async () => {
    const ports = createConversationDeliberationCliExecutionPorts({
      executable: "/opt/lervo/bin/lervo",
      repositoryRoot: "/srv/project",
      process: {
        run: async () => ({
          exitCode: 2,
          stdout: JSON.stringify({
            schemaVersion: 1,
            deliberationId: "dlb_queue0001",
            status: "failed",
            artifactCount: 4,
          }),
          stderr: JSON.stringify({ code: "deliberation_budget_exhausted" }),
        }),
      },
    });
    await expect(
      ports.start.execute({
        operation: "start",
        projectId: "prj_control01",
        sourceEventId: `cve_${"a".repeat(64)}`,
        deliberationId: "dlb_queue0001",
        requestHash: `sha256:${"b".repeat(64)}`,
        principalHash: `sha256:${"c".repeat(64)}`,
        origin: {
          conversationId: "cnv_control01",
          threadId: null,
          requesterParticipantId: "ptc_control01",
          originBindingDigest: `sha256:${"d".repeat(64)}`,
        },
        policyId: "deliberation_product-review",
        topic: "Review the product boundary.",
        requestedAt: "2026-09-09T00:00:00.000Z",
        state: "leased",
        attemptCount: 1,
        leaseExpiresAt: "2026-09-09T00:05:00.000Z",
        summary: null,
        failureCode: null,
        reconciliation: null,
      }),
    ).resolves.toMatchObject({ status: "failed", artifactCount: 4 });
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
