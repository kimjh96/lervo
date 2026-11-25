import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  claimAssignment,
  createAssignment,
  readWorkspace,
  registerAgent,
} from "@lervo/agent-workforce";
import { applyWorkspaceProvision, planWorkspaceProvision } from "@lervo/orchestrator";

import {
  applyKnowledgeInstructionBridgePlan,
  applyKnowledgeMigrationPlan,
  applyTerminalIntegrationPlan,
  canonicalJson,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  createTerminalIntegrationPlan,
  lintRepositoryKnowledge,
  listKnowledgeArtifactPaths,
  sha256,
  structuralConceptDirectory,
  terminalHookCommand,
} from "@lervo/repository-knowledge";
import { openProjectStorage, RepositoryCoordinationRecords } from "@lervo/project-storage";
import {
  activateFixtureEventWriterV2,
  activateFixtureEventWriterV3,
} from "../../../packages/project/test/fixture-event-writer.js";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { afterEach, describe, expect, it } from "vitest";

import { runCli as runCliBase } from "../src/main.js";
import {
  applyTerminalIntegrationStage,
  planTerminalIntegrationStage,
} from "../src/terminal-integration-stage.js";
import { commitRepository } from "./committed-repository.js";
import { agreeingCrossCheck } from "./plan-cross-check-fixture.js";
import { holdEffect } from "../src/held-effect-debt.js";
import {
  inspectTerminalIntegration,
  terminalIntegrationHoldSubject,
} from "../src/upgrade-terminal-inspection.js";
import { terminalTurnDeclarationRequired } from "../src/terminal-lifecycle-inspection.js";
import { terminalKnowledgeSnapshotId } from "../src/terminal-compact-context.js";
import { captureTerminalRepositorySnapshot } from "../src/terminal-repository-snapshot.js";
import { recordKnowledgeResidentHealth } from "@lervo/repository-knowledge-runtime";
const runCli: typeof runCliBase = (args, io, overrides = {}) =>
  runCliBase(args, io, {
    ...agreeingCrossCheck,
    groundProductionRequest: async ({ request, provider }) => {
      const requestDigest = `sha256:${createHash("sha256").update(request).digest("hex")}` as const;
      return {
        proposal: {
          schemaVersion: 1,
          requestDigest,
          resolver: {
            kind: "provider_adapter",
            providerId: provider,
            resultDigest: `sha256:${"b".repeat(64)}`,
          },
          intent: "explain",
          subjectIds: ["repository.context"],
          references: [],
          protocolCoordinates: [],
          requestedEffectIds: ["terminal.answer"],
          prohibitedEffectIds: [],
          sourceClasses: ["repository_state"],
          retrievalQueries: [request],
          workflowCandidateIds: ["terminal.answer"],
          capabilityCandidateIds: [],
          authorityRequirement: "read",
          providerRoute: { mode: "current_provider_only", providerIds: [] },
          disposition: "answer",
          ambiguityReasons: [],
          durableInstruction: {
            disposition: "none",
            speechAct: "other",
            authority: "inferred",
            durability: "unspecified",
            operation: "none",
            scope: { kind: "unspecified", paths: [] },
            title: null,
            statement: null,
            exceptions: [],
            risk: "unknown",
            conflict: "unknown",
            confidence: "low",
            reasonIds: [],
          },
        },
        decision: {
          schemaVersion: 1,
          status: "ready",
          workflowId: "terminal.answer",
          effectIds: ["terminal.answer"],
          capabilityIds: [],
          providerIds: [provider],
          authority: "read",
          sourceClasses: ["repository_state"],
          subjectIds: ["repository.context"],
          retrievalQueries: [request],
          reasons: [],
        },
      };
    },
    ...overrides,
  });

const roots: string[] = [];
const execute = promisify(execFile);
const runtimeContent = "#!/usr/bin/env node\nprocess.stdout.write('{}\\n');\n";

async function initializedRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-terminal-"));
  roots.push(root);
  await writeFile(
    resolve(root, "README.md"),
    "# Terminal fixture\n\nThe atlas cache uses immutable blue envelopes.\n",
  );
  await writeFile(
    resolve(root, "AGENTS.md"),
    "# Agent instructions\n\nUse repository knowledge before changes.\n",
  );
  const io = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init"], io)).toBe(0);
  const structural = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  await applyKnowledgeMigrationPlan(structural, new Date(), () => undefined);
  const bridge = await createKnowledgeInstructionBridgePlan({
    repositoryRoot: root,
    provider: "claude",
  });
  await applyKnowledgeInstructionBridgePlan({
    plan: bridge,
    approvedOperationId: bridge.operationId,
    approvedHash: bridge.approvalHash,
    now: new Date(),
    recordApplied: () => undefined,
  });
  const terminal = await createTerminalIntegrationPlan(root, runtimeContent);
  await applyTerminalIntegrationPlan({
    plan: terminal,
    runtimeContent,
    now: new Date(),
    recordApplied: () => undefined,
  });
  const refreshed = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  if (refreshed.operations.some((item) => item.action !== "unchanged"))
    await applyKnowledgeMigrationPlan(refreshed, new Date(), () => undefined);
  return root;
}

async function managedWorkerRepository() {
  const repositoryRoot = await initializedRepository();
  await execute("git", ["-C", repositoryRoot, "init"]);
  await execute("git", [
    "-C",
    repositoryRoot,
    "config",
    "user.email",
    "lervo-test@example.invalid",
  ]);
  await execute("git", ["-C", repositoryRoot, "config", "user.name", "Lervo Test"]);
  await execute("git", ["-C", repositoryRoot, "add", "."]);
  await execute("git", ["-C", repositoryRoot, "commit", "-m", "fixture"]);
  const { stdout } = await execute("git", ["-C", repositoryRoot, "rev-parse", "HEAD"]);
  const baseCommit = stdout.trim();
  const agent = await registerAgent({
    repositoryRoot,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["README.md"],
  });
  const assignment = await createAssignment({
    repositoryRoot,
    taskType: "implementation",
    roleId: "developer",
    acceptanceCriteria: ["Update the assigned document."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: ["README.md"],
  });
  const claimed = await claimAssignment({
    repositoryRoot,
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_terminal_worker_fixture",
  });
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-cli-worker-parent-"));
  roots.push(parent);
  const workspacePath = resolve(parent, "worker");
  const host = new GitWorkspaceHostAdapter();
  const plan = await planWorkspaceProvision({
    repositoryRoot,
    workspacePath,
    assignmentId: claimed.assignmentId,
    agentId: agent.agentId,
    leaseId: claimed.lease!.leaseId,
    provider: "codex",
    baseCommit,
    integrationTargetDigest: sha256("terminal-worker-target"),
    executionKind: "worker",
    host,
  });
  await applyWorkspaceProvision({ plan, host });
  return { repositoryRoot, workspacePath, workspaceId: plan.workspace.workspaceId };
}

afterEach(async () => {
  // ADR-0531: a failed hook may return before abandoned sibling stages finish their state writes.
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});

describe("terminal integration CLI", () => {
  it.each([2, 3] as const)(
    "records bounded monotonic prompt and Stop stages with a version-%i writer",
    async (writer) => {
      const root = await initializedRepository();
      const initialStorage = await openProjectStorage(root);
      const projectId = initialStorage.manifest.projectId;
      await initialStorage.close();
      await (writer === 3 ? activateFixtureEventWriterV3 : activateFixtureEventWriterV2)({
        repositoryRoot: root,
        projectId,
        observedAt: "2026-09-01T00:00:00.000Z",
      });
      const invoke = (hookEvent: "UserPromptSubmit" | "Stop") =>
        runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], {
          cwd: root,
          stdout: () => undefined,
          stderr: () => undefined,
          stdin: async () =>
            JSON.stringify({
              hook_event_name: hookEvent,
              session_id: "timed-terminal-session",
              turn_id: "timed-terminal-turn",
              ...(hookEvent === "UserPromptSubmit"
                ? { prompt: "Explain the terminal fixture." }
                : { last_assistant_message: "Done." }),
            }),
        });

      expect(await invoke("UserPromptSubmit")).toBe(0);
      expect(await invoke("Stop")).toBe(0);

      await expect(
        access(resolve(root, ".lervo/state/terminal-integration/knowledge-lifecycle-cache.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const storage = await openProjectStorage(root);
      try {
        const stages = storage.events
          .list()
          .filter((event) => event.type === "execution.stages.observed");
        expect(stages).toHaveLength(2);
        expect(stages.map((event) => event.schemaVersion)).toEqual([2, 2]);
        expect(stages.map((event) => event.payload.stageCatalogVersion)).toEqual([2, 2]);
        expect(stages[0]!.payload).toMatchObject({
          executionMode: "unmanaged_terminal",
          workId: null,
          repositoryProfile: "custom",
        });
        expect(
          (stages[0]!.payload.stages as Array<{ stageId: string }>).map((item) => item.stageId),
        ).toEqual(
          expect.arrayContaining([
            "ingress_integrity",
            "repository_discovery",
            "query_projection",
            "corpus_preparation",
            "context_assembly",
            "event_commit",
            "total",
          ]),
        );
        expect(
          (stages[1]!.payload.stages as Array<{ stageId: string }>).map((item) => item.stageId),
        ).toEqual(
          expect.arrayContaining([
            "ingress_integrity",
            "repository_discovery",
            "lifecycle_inspection",
            "event_commit",
            "total",
          ]),
        );
        for (const event of stages) {
          const digest = String(event.payload.environmentProfileDigest);
          expect(await storage.artifacts.has(`lervo-cas://sha256/${digest.slice(7)}`)).toBe(true);
        }
      } finally {
        await storage.close();
      }
      const budgetMessages: string[] = [];
      const budgetErrors: string[] = [];
      expect(
        await runCli(["terminal", "budget", "--limit", "1", "--minimum-samples", "1", "--json"], {
          cwd: root,
          stdout: (message: string) => budgetMessages.push(message),
          stderr: (message: string) => budgetErrors.push(message),
        }),
        budgetErrors.join(""),
      ).toBe(0);
      expect(JSON.parse(budgetMessages.join(""))).toMatchObject({
        reportKind: "unmanaged_terminal_budget",
        disposition: "passed",
        hookProfiles: [
          { hookEvent: "Stop", status: "below" },
          { hookEvent: "UserPromptSubmit", status: "below" },
        ],
        queryProjections: [{ status: "not_configured" }],
      });
    },
  );

  it("checkpoints an attached worker without requiring foreign global lifecycle updates", async () => {
    const fixture = await managedWorkerRepository();
    const invoke = async (
      event: "UserPromptSubmit" | "Stop",
      turnId: string,
      providerSessionId = "managed-worker-provider-session",
    ) => {
      const messages: string[] = [];
      const errors: string[] = [];
      expect(
        await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], {
          cwd: fixture.workspacePath,
          stdout: (message: string) => messages.push(message),
          stderr: (message: string) => errors.push(message),
          stdin: async () =>
            JSON.stringify(
              event === "UserPromptSubmit"
                ? {
                    hook_event_name: event,
                    session_id: providerSessionId,
                    turn_id: turnId,
                    prompt: "Update the assigned document.",
                  }
                : {
                    hook_event_name: event,
                    session_id: providerSessionId,
                    turn_id: turnId,
                    last_assistant_message: "Done.",
                  },
            ),
        }),
        errors.join(""),
      ).toBe(0);
      expect(errors).toEqual([]);
      return JSON.parse(messages.join("")) as {
        decision?: string;
        reason?: string;
        hookSpecificOutput?: { additionalContext: string };
      };
    };

    const prepared = await invoke("UserPromptSubmit", "worker-turn-1");
    expect(prepared.hookSpecificOutput?.additionalContext).toContain(
      "does not advance the repository-wide workstream",
    );
    const inspectionOutput: string[] = [];
    expect(
      await runCli(["workspace", "inspect", "--json"], {
        cwd: fixture.workspacePath,
        stdout: (message: string) => inspectionOutput.push(message),
        stderr: () => undefined,
      }),
    ).toBe(0);
    expect(JSON.parse(inspectionOutput.join(""))).toMatchObject({
      status: "current",
      inspections: [{ workspace: { workspaceId: fixture.workspaceId, state: "active" } }],
    });
    const secondWriterOutput: string[] = [];
    expect(
      await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], {
        cwd: fixture.workspacePath,
        stdout: (message: string) => secondWriterOutput.push(message),
        stderr: () => undefined,
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "foreign-writer-session",
            turn_id: "foreign-writer-turn",
            prompt: "Mutate the same checkout.",
          }),
      }),
    ).toBe(0);
    expect(JSON.parse(secondWriterOutput.join(""))).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("writer_lease_lost"),
    });
    await writeFile(resolve(fixture.workspacePath, "README.md"), "# Assigned worker change\n");
    expect(await invoke("Stop", "worker-turn-1")).toEqual({});
    expect(
      (await readWorkspace(fixture.workspacePath, fixture.workspaceId))?.workspace,
    ).toMatchObject({ state: "paused", writerSession: null });

    const records = await RepositoryCoordinationRecords.open(fixture.workspacePath);
    const checkpoint = (await records.list<Record<string, unknown>>("events")).find(
      (record) =>
        record.value.workspaceId === fixture.workspaceId && "writerSessionId" in record.value,
    );
    expect(checkpoint?.value).toMatchObject({
      workspaceId: fixture.workspaceId,
      changedPathCount: 1,
      checkoutClean: false,
    });

    const resumed = await invoke(
      "UserPromptSubmit",
      "worker-turn-2",
      "replacement-worker-provider-session",
    );
    expect(resumed.hookSpecificOutput?.additionalContext).toContain(
      "is resumed on worker workspace",
    );
    await writeFile(resolve(fixture.workspacePath, "outside-scope.txt"), "foreign\n");
    const blocked = await invoke("Stop", "worker-turn-2", "replacement-worker-provider-session");
    expect(blocked).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("workspace_path_escape"),
    });
    expect(blocked.reason).not.toMatch(/workstream_checkpoint_required|migrate knowledge/u);
  }, 30_000);

  it("reapplies a repeated runtime transition after an intervening application event", async () => {
    const root = await initializedRepository();
    const errors: string[] = [];
    const migrate = async (...args: string[]) => {
      const messages: string[] = [];
      expect(
        await runCli(["migrate", "knowledge", ...args, "--json"], {
          cwd: root,
          stdout: (message: string) => messages.push(message),
          stderr: (message: string) => errors.push(message),
        }),
        errors.join("\n"),
      ).toBe(0);
      return JSON.parse(messages.join("")) as {
        planKind?: string;
        planId: string;
        status?: string;
        operation?: string;
        operationId?: string;
        approvalHash?: string | null;
        userUpdates?: Array<{ operationId: string; approvalHash: string }>;
      };
    };
    const terminalPlan = async () => {
      for (let index = 0; index < 10; index += 1) {
        let plan = await migrate();
        // A reviewed plan lands as its own undo commit over committed sources; committing moves
        // HEAD, so the plan is made again.
        if (plan.status === "review_required" && commitRepository(root)) plan = await migrate();
        if (plan.planKind === "terminal_integration") return plan;
        await migrate("--apply", plan.planId);
      }
      throw new Error("Terminal integration plan did not become reachable.");
    };

    const first = await terminalPlan();
    expect(first.status).toBe("ready");
    await migrate("--apply", first.planId);
    const installedRuntime = await readFile(
      resolve(root, ".lervo/generated/terminal-hooks/runtime-v2.mjs"),
      "utf8",
    );

    await writeFile(
      resolve(root, ".lervo/generated/terminal-hooks/runtime-v2.mjs"),
      runtimeContent,
    );
    await writeFile(
      resolve(root, ".lervo/generated/terminal-hooks/runtime-v2.json"),
      `${canonicalJson({
        schemaVersion: 1,
        kind: "lervo_terminal_hook_runtime",
        contractId: "lervo_terminal_hooks_v2",
        runtimePath: ".lervo/generated/terminal-hooks/runtime-v2.mjs",
        contentHash: sha256(runtimeContent),
        byteCount: Buffer.byteLength(runtimeContent),
      })}\n`,
    );

    const repeated = await terminalPlan();
    expect(repeated.status).toBe("ready");
    expect(repeated.planId).not.toBe(first.planId);
    const applied = await migrate("--apply", repeated.planId);
    expect(applied.operation).toBe("terminal_integration_update");
    expect(
      await readFile(resolve(root, ".lervo/generated/terminal-hooks/runtime-v2.mjs"), "utf8"),
    ).toBe(installedRuntime);
  }, 30_000);

  it("records stale knowledge lifecycle without blocking unmanaged provider completion", async () => {
    const root = await initializedRepository();
    const preparedErrors: string[] = [];
    expect(
      await runCli(["terminal", "hook", "--provider", "claude", "--contract", "2"], {
        cwd: root,
        stdout: () => undefined,
        stderr: (message: string) => preparedErrors.push(message),
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "claude-session-stale",
            prompt: "repository guidance",
          }),
      }),
      preparedErrors.join(""),
    ).toBe(0);
    await writeFile(
      resolve(root, "README.md"),
      "# Terminal fixture\n\nChanged durable repository guidance.\n",
    );
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
      stdin: async () =>
        JSON.stringify({
          hook_event_name: "Stop",
          session_id: "claude-session-stale",
          stop_hook_active: false,
          last_assistant_message: "Lifecycle check only.",
        }),
    };
    expect(
      await runCli(["terminal", "hook", "--provider", "claude", "--contract", "2"], io),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toEqual({});
    expect(
      JSON.parse(
        await readFile(resolve(root, ".lervo/state/terminal-integration/claude-stop.json"), "utf8"),
      ),
    ).toMatchObject({
      provider: "claude",
      hookEvent: "Stop",
      result: "completion_allowed",
      referenceCount: 0,
      observationEventId: expect.stringMatching(/^evt_/u),
    });
    expect(errors).toEqual([]);

    const allowedReceipt = await readFile(
      resolve(root, ".lervo/state/terminal-integration/claude-stop.json"),
      "utf8",
    );
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1_000 });
    const eventCount = events.length;
    expect(
      events.filter((event) => event.type === "terminal.turn.observed").at(-1)?.payload,
    ).toMatchObject({
      lifecycleStatus: "action_required",
      completionResult: "allowed",
    });
    await storage.close();
    messages.length = 0;
    expect(
      await runCli(["terminal", "hook", "--provider", "claude", "--contract", "2"], {
        cwd: root,
        stdout: (message: string) => messages.push(message),
        stderr: (message: string) => errors.push(message),
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "Stop",
            session_id: "claude-session-stale",
            stop_hook_active: true,
            last_assistant_message: "Lifecycle check continued.",
          }),
      }),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toEqual({});
    expect(
      await readFile(resolve(root, ".lervo/state/terminal-integration/claude-stop.json"), "utf8"),
    ).toBe(allowedReceipt);
    const continuedStorage = await openProjectStorage(root);
    expect(continuedStorage.events.list({ limit: 1_000 })).toHaveLength(eventCount);
    await continuedStorage.close();
  });

  it("keeps structural publications when a later lifecycle stage was already stale", async () => {
    const root = await initializedRepository();
    await writeFile(
      resolve(root, "CLAUDE.md"),
      `${await readFile(resolve(root, "CLAUDE.md"), "utf8")}\nUser-owned trailing guidance.\n`,
    );
    await rm(resolve(root, "docs/knowledge"), { recursive: true });
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["knowledge", "refresh", "--json"], io), errors.join("")).toBe(0);
    const plan = JSON.parse(messages.join("")) as { planId: string };
    messages.length = 0;
    expect(
      await runCli(["knowledge", "refresh", "--apply", plan.planId, "--json"], io),
      errors.join(""),
    ).toBe(0);
    await expect(access(resolve(root, "docs/knowledge/index.md"))).resolves.toBeUndefined();
    const lint = await lintRepositoryKnowledge(root);
    expect(lint.issues).toContainEqual(
      expect.objectContaining({ code: "instruction_bridge_binding_stale" }),
    );
  });

  it("keeps lifecycle planning failures observable without blocking unmanaged completion", async () => {
    const root = await initializedRepository();
    await runCli(["terminal", "hook", "--provider", "claude", "--contract", "2"], {
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
      stdin: async () =>
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "claude-session-bridge-failure",
          prompt: "repository guidance",
        }),
    });
    const conceptPath = (
      await listKnowledgeArtifactPaths({
        root,
        directory: structuralConceptDirectory,
        extension: "yaml",
        maximumFiles: 20_000,
      })
    )[0]!;
    await writeFile(resolve(root, conceptPath), "schemaVersion: 1\nmergeResolved: true\n");
    const messages: string[] = [];
    const errors: string[] = [];
    expect(
      await runCli(["terminal", "hook", "--provider", "claude", "--contract", "2"], {
        cwd: root,
        stdout: (message) => messages.push(message),
        stderr: (message) => errors.push(message),
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "Stop",
            session_id: "claude-session-bridge-failure",
            last_assistant_message: "Lifecycle check only.",
          }),
      }),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toEqual({});
    expect(errors).toEqual([]);

    messages.length = 0;
    expect(
      await runCli(["terminal", "status"], {
        cwd: root,
        stdout: (message) => messages.push(message),
        stderr: (message) => errors.push(message),
      }),
    ).toBe(1);
    expect(messages.join("")).toContain("repository_layout_inspection_failed");
    expect(messages.join("")).toContain("The knowledge concept registry is incomplete");
    expect(errors).toEqual([]);
  });

  it("passes malformed hook input through without blocking or echoing it (ADR-0635)", async () => {
    const root = await initializedRepository();
    const secret = "prompt-secret-fixture";
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
      stdin: async () => `{${secret}`,
    };
    // A nonzero exit would block the prompt; the failure is recorded instead.
    expect(await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], io)).toBe(
      0,
    );
    expect(messages).toEqual(["{}\n"]);
    expect(errors.join("")).toBe("Lervo terminal integration failed (hook_input_invalid).\n");
    expect(errors.join("")).not.toContain(secret);
  });

  it("recovers a Stop hook activated after its turn started without claiming observation", async () => {
    const root = await initializedRepository();
    const invoke = async (stopHookActive: boolean) => {
      const messages: string[] = [];
      const errors: string[] = [];
      const exitCode = await runCli(
        ["terminal", "hook", "--provider", "codex", "--contract", "2"],
        {
          cwd: root,
          stdout: (message) => messages.push(message),
          stderr: (message) => errors.push(message),
          stdin: async () =>
            JSON.stringify({
              hook_event_name: "Stop",
              session_id: "mid-turn-upgrade",
              turn_id: "turn-before-hook-install",
              stop_hook_active: stopHookActive,
              last_assistant_message: "The repository work is complete.",
            }),
        },
      );
      return {
        exitCode,
        output: JSON.parse(messages.join("")) as { decision?: string; reason?: string },
        errors,
      };
    };

    const recovery = await invoke(false);
    expect(recovery).toEqual({ exitCode: 0, output: {}, errors: [] });
    const continued = await invoke(true);
    expect(continued).toEqual({ exitCode: 0, output: {}, errors: [] });
    await expect(
      access(resolve(root, ".lervo/state/terminal-integration/codex-stop.json")),
    ).rejects.toThrow();
  });

  it("migrates existing Claude settings through the normal knowledge command without replacing existing hooks", async () => {
    const root = await initializedRepository();
    await writeFile(
      resolve(root, ".claude/settings.json"),
      '{"permissions":{"deny":["Bash"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"existing-stop"}]}]}}\n',
    );
    commitRepository(root);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    // Earlier stages apply first; a reviewed one lands as its own commit, which moves HEAD, a
    // knowledge source, so a structural refresh can follow it.
    for (let stage = 0; stage < 6; stage += 1) {
      messages.length = 0;
      expect(await runCli(["migrate", "knowledge", "--json"], io), errors.join("")).toBe(0);
      const intermediate = JSON.parse(messages.join("")) as {
        planKind?: string;
        planId: string;
        operations?: Array<{ action: string }>;
      };
      if (
        intermediate.planKind === "terminal_integration" ||
        intermediate.operations?.every((item) => item.action === "unchanged") === true
      )
        break;
      messages.length = 0;
      expect(
        await runCli(["migrate", "knowledge", "--apply", intermediate.planId, "--json"], io),
        errors.join(""),
      ).toBe(0);
    }
    const plan = JSON.parse(messages.join("")) as {
      planKind: string;
      planId: string;
      operationId: string;
      approvalHash: string;
    };
    expect(plan.planKind).toBe("terminal_integration");
    const original = await readFile(resolve(root, ".claude/settings.json"), "utf8");
    messages.length = 0;
    // ADR-0561: the removed item approval fails briefly and changes nothing.
    expect(
      await runCli(
        ["migrate", "knowledge", "--apply", plan.planId, "--approve-item", "ktermop_x=y"],
        io,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("--approve-item was removed");
    expect(await readFile(resolve(root, ".claude/settings.json"), "utf8")).toBe(original);
    errors.length = 0;
    expect(
      await runCli(["migrate", "knowledge", "--apply", plan.planId, "--json"], io),
      errors.join(""),
    ).toBe(0);
    const receipt = JSON.parse(messages.join("")) as { backupId: string };
    expect(receipt.backupId).toMatch(/^lbk_[a-f0-9]{24}$/u);
    const settings = JSON.parse(await readFile(resolve(root, ".claude/settings.json"), "utf8"));
    expect(settings.permissions).toEqual({ deny: ["Bash"] });
    expect(
      settings.hooks.Stop.some((item: { hooks: Array<{ command: string }> }) =>
        item.hooks.some((hook) => hook.command === "existing-stop"),
      ),
    ).toBe(true);
    expect(
      settings.hooks.Stop.some((item: { hooks: Array<{ command: string }> }) =>
        item.hooks.some((hook) => hook.command === terminalHookCommand("claude")),
      ),
    ).toBe(true);
    // The backup restores the provider hook file byte for byte.
    expect(await runCli(["state", "restore", receipt.backupId], io), errors.join("")).toBe(0);
    expect(await readFile(resolve(root, ".claude/settings.json"), "utf8")).toBe(original);
    // ADR-0561: an owner who undid the merge does not get it again until they release the hold.
    expect((await inspectTerminalIntegration(root)).stage).toMatchObject({
      disposition: "lervo_debt",
      reason: "owner_restored",
    });
    expect(await runCli(["repository", "release", "--root", root], io), errors.join("")).toBe(0);
    // ADR-0610: the merge landed as a commit, so the restored file is the owner's uncommitted
    // change; Lervo waits over it and applies again once the owner commits it.
    expect((await inspectTerminalIntegration(root)).stage).toMatchObject({
      disposition: "lervo_debt",
      reason: "paths_uncommitted",
    });
    commitRepository(root);
    expect((await inspectTerminalIntegration(root)).stage).toMatchObject({
      disposition: "safe_apply",
    });
  }, 15_000);

  it("restores the provider hook files from the backup when the applied integration does not verify", async () => {
    const root = await initializedRepository();
    const original = '{"permissions":{"deny":["Bash"]}}\n';
    await writeFile(resolve(root, ".claude/settings.json"), original);
    const codexHooks = await readFile(resolve(root, ".codex/hooks.json"), "utf8");
    const prepared = await planTerminalIntegrationStage(root);
    expect(prepared.plan.status).toBe("ready");
    await expect(
      applyTerminalIntegrationStage({
        repositoryRoot: root,
        prepared,
        now: new Date(),
        verify: async () => "the fixture reader rejected the hooks",
      }),
    ).rejects.toMatchObject({ code: "terminal_integration_verification_failed" });
    expect(await readFile(resolve(root, ".claude/settings.json"), "utf8")).toBe(original);
    expect(await readFile(resolve(root, ".codex/hooks.json"), "utf8")).toBe(codexHooks);
    // The plan reads the held verification failure, so an upgrade does not loop on it.
    await holdEffect({
      repositoryRoot: root,
      effect: "upgrade_terminal_integration",
      subject: terminalIntegrationHoldSubject(prepared.plan),
      reasonCode: "verification_failed",
    });
    expect((await inspectTerminalIntegration(root)).stage).toMatchObject({
      disposition: "lervo_debt",
      reason: "verification_failed",
    });
  });

  it("restores the provider hook files when the apply itself fails part-way", async () => {
    const root = await initializedRepository();
    const original = '{"permissions":{"deny":["Bash"]}}\n';
    await writeFile(resolve(root, ".claude/settings.json"), original);
    const prepared = await planTerminalIntegrationStage(root);
    expect(prepared.plan.status).toBe("ready");
    // The last published file interrupts the apply, after every other file was written.
    const published = prepared.plan.targets.filter(
      (target) => target.action === "create" || target.action === "update",
    ).length;
    await expect(
      applyTerminalIntegrationStage({
        repositoryRoot: root,
        prepared,
        now: new Date(),
        failureInjector: (checkpoint) =>
          checkpoint === `published:${published - 1}` ? "interrupt" : undefined,
      }),
    ).rejects.toThrow();
    expect(await readFile(resolve(root, ".claude/settings.json"), "utf8")).toBe(original);
  });
});

describe("compact terminal prompt context", () => {
  it("records only delivered exact-anchor pointers without loading their bodies", async () => {
    const root = await initializedRepository();
    const path = "docs/decisions/0541-observe-turn.md";
    const body = "# ADR-0541: Observe the turn\n\nKeep reference evidence distinct from use.\n";
    await mkdir(resolve(root, "docs/decisions"), { recursive: true });
    await writeFile(resolve(root, path), body);
    let output = "";
    expect(
      await runCli(["terminal", "hook", "--provider", "claude", "--contract", "2"], {
        cwd: root,
        stdout: (text) => {
          output += text;
        },
        stderr: () => undefined,
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "anchor-session",
            prompt: "ADR-0541",
          }),
      }),
    ).toBe(0);
    const context = JSON.parse(output).hookSpecificOutput.additionalContext;
    expect(context).toContain(path);
    expect(context).not.toContain("Keep reference evidence distinct from use.");
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list({ limit: 1000 })
        .findLast((item) => item.type === "terminal.context.prepared");
      expect(event?.payload).toMatchObject({
        selectedPointers: [{ path, contentHash: sha256(body), kind: "decision" }],
        loadedDocuments: [],
        selectionStatus: "selected",
        loadingStatus: "not_run",
        providerUseStatus: "unknown",
      });
    } finally {
      await storage.close();
    }
  });

  it.each(["codex", "claude"] as const)(
    "delivers publication policy and continuation without query projection for %s",
    async (provider) => {
      const root = await initializedRepository();
      await writeFile(
        resolve(root, "HANDOFF.md"),
        "# Active launch handoff\n\n## Current objective\n\nFinish the cobalt launch gate.\n\n## Next actions\n\n- Verify the device build.\n",
      );
      commitRepository(root);
      const migrationOutput: string[] = [];
      const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
      expect(
        await runCli(["migrate", "knowledge", "--json"], {
          ...quiet,
          stdout: (message) => migrationOutput.push(message),
        }),
      ).toBe(0);
      const migration = JSON.parse(migrationOutput.join("")) as {
        planId: string;
        operationId: string;
        approvalHash: string;
      };
      expect(await runCli(["migrate", "knowledge", "--apply", migration.planId], quiet)).toBe(0);
      await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
      await writeFile(
        resolve(root, `docs/instructions/generated/rule_${"d".repeat(24)}.md`),
        "# Preserve examples\n\nRequired clause: preserve quoted source.\n\n## Exceptions\n\nTranslate only when explicitly requested.\n",
      );
      const messages: string[] = [];
      expect(
        await runCli(["terminal", "hook", "--provider", provider, "--contract", "2"], {
          ...quiet,
          stdout: (message) => messages.push(message),
          stdin: async () =>
            JSON.stringify({
              hook_event_name: "UserPromptSubmit",
              session_id: "compact-session",
              turn_id: "turn-compact",
              prompt: "변경 내용을 문서로 정리해줘",
            }),
        }),
      ).toBe(0);
      const context = JSON.parse(messages.join("")).hookSpecificOutput.additionalContext as string;
      expect(context).toContain("Lervo compact terminal context");
      expect(context).toContain("publication.language=en; writingPolicyId=writing_en-human");
      expect(context).toContain("Write new or revised repository documentation in English");
      expect(context).toContain("does not choose the chat response language");
      expect(context).toContain("Verify the device build.");
      expect(context).toContain("Required clause: preserve quoted source.");
      expect(context).toContain("Translate only when explicitly requested.");
      expect(context).not.toContain("## Lervo current workstream");
      expect(context).not.toContain("immutable blue envelopes");
      expect(Buffer.byteLength(context)).toBeLessThan(6 * 1024);
      const activation = JSON.parse(
        await readFile(
          resolve(root, `.lervo/state/terminal-integration/${provider}-user-prompt-submit.json`),
          "utf8",
        ),
      );
      expect(activation.preparationQuality).toMatchObject({
        instructions: {
          scope: "applied_owner_rules",
          status: "complete",
          preparedCount: 1,
          omittedCount: 0,
          delivery: "unobserved",
        },
        retrieval: "not_run",
        candidateCount: null,
        selectedCount: 0,
        fullCount: 0,
        reasonCodes: ["retrieval_not_run"],
        planningReadiness: {
          status: "unavailable",
          reasonCode: "context_binding_unavailable",
          missingBindings: expect.arrayContaining([
            "authority_scope",
            "applicable_policy",
            "normalized_task",
          ]),
        },
        corpusCoverage: "unobserved",
        delivery: "unobserved",
      });
      const recorded = await openProjectStorage(root);
      try {
        expect(recorded.events.get(activation.observationEventId)?.payload).toMatchObject({
          workstreamScope: "prefix",
          selectionStatus: "not_selected",
          loadingStatus: "not_run",
          providerInjectionStatus: "unobserved",
          providerUseStatus: "unknown",
          recommendationCount: 0,
          loadedDocuments: [],
        });
      } finally {
        await recorded.close();
      }
    },
  );

  it("caches the knowledge snapshot identity by exact repository revision", async () => {
    const root = await initializedRepository();
    const first = await captureTerminalRepositorySnapshot(root);
    const identity = await terminalKnowledgeSnapshotId(root, first.revision);
    expect(identity).toMatch(/^ksnap_[a-f0-9]{24}$/u);
    expect(
      JSON.parse(
        await readFile(
          resolve(root, ".lervo/state/cache/terminal-knowledge-snapshot.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ repositoryRevision: first.revision, sourceSnapshotId: identity });
    expect(await terminalKnowledgeSnapshotId(root, first.revision)).toBe(identity);
    await writeFile(resolve(root, "README.md"), "# Terminal fixture\n\nA changed fact.\n");
    const second = await captureTerminalRepositorySnapshot(root);
    expect(second.revision).not.toBe(first.revision);
    expect(await terminalKnowledgeSnapshotId(root, second.revision)).not.toBe(identity);
  });

  it("requires a turn declaration only while no background knowledge owner is healthy", async () => {
    const root = await initializedRepository();
    expect(await terminalTurnDeclarationRequired(root)).toBe(true);
    await recordKnowledgeResidentHealth({
      repositoryRoot: root,
      workerId: "compact-test-worker",
      state: "idle",
    });
    expect(await terminalTurnDeclarationRequired(root)).toBe(false);
  });
});
