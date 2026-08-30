import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { claimAssignment, createAssignment, registerAgent } from "@lervo/agent-workforce";
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
  listCanonicalizationCandidates,
  listKnowledgeArtifactPaths,
  sha256,
  structuralConceptDirectory,
  terminalHookCommand,
} from "@lervo/repository-knowledge";
import { openProjectStorage, RepositoryCoordinationRecords } from "@lervo/project-storage";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { afterEach, describe, expect, it } from "vitest";

import { runCli as runCliBase } from "../src/main.js";
import { GroundProductionRequestError } from "../src/semantic-grounding.js";

const runCli: typeof runCliBase = (args, io, overrides = {}) =>
  runCliBase(args, io, {
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
    approvedOperationId: terminal.operationId,
    approvedHash: terminal.approvalHash!,
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
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("terminal integration CLI", () => {
  it("materializes one explicit durable user rule without retaining prompt prose", async () => {
    const root = await initializedRepository();
    const messages: string[] = [];
    const prompt = "앞으로 이 저장소의 모든 커밋은 Conventional Commits 형식을 따르세요.";
    let observedCatalog: unknown;
    expect(
      await runCli(
        ["terminal", "hook", "--provider", "codex", "--contract", "2"],
        {
          cwd: root,
          stdout: (message) => messages.push(message),
          stderr: () => undefined,
          stdin: async () =>
            JSON.stringify({
              hook_event_name: "UserPromptSubmit",
              session_id: "durable-rule-session",
              turn_id: "durable-rule-turn",
              prompt,
            }),
        },
        {
          groundProductionRequest: async ({ request, semanticCatalog }) => {
            observedCatalog = semanticCatalog;
            return {
              proposal: {
                schemaVersion: 1,
                requestDigest: `sha256:${createHash("sha256").update(request).digest("hex")}`,
                resolver: {
                  kind: "provider_adapter",
                  providerId: "codex",
                  resultDigest: `sha256:${"c".repeat(64)}`,
                },
                intent: "change",
                subjectIds: ["repository.instructions"],
                references: [],
                protocolCoordinates: [],
                requestedEffectIds: ["repository.change"],
                prohibitedEffectIds: [],
                sourceClasses: ["repository_state"],
                retrievalQueries: ["commit message instructions"],
                workflowCandidateIds: ["terminal.repository_change"],
                capabilityCandidateIds: [],
                authorityRequirement: "repository_write",
                providerRoute: { mode: "current_provider_only", providerIds: [] },
                disposition: "execute",
                ambiguityReasons: [],
                durableInstruction: {
                  disposition: "canonical",
                  speechAct: "directive",
                  authority: "explicit_user",
                  durability: "repository",
                  operation: "add",
                  scope: { kind: "repository", paths: [] },
                  title: "Conventional commit messages",
                  statement: "Use Conventional Commits for every repository commit.",
                  exceptions: [],
                  risk: "low",
                  conflict: "none",
                  confidence: "high",
                  reasonIds: ["explicit_repository_rule"],
                },
              },
              decision: {
                schemaVersion: 1,
                status: "ready",
                workflowId: "terminal.repository_change",
                effectIds: ["repository.change"],
                capabilityIds: [],
                providerIds: ["codex"],
                authority: "repository_write",
                sourceClasses: ["repository_state"],
                subjectIds: ["repository.instructions"],
                retrievalQueries: ["commit message instructions"],
                reasons: [],
              },
            };
          },
        },
      ),
    ).toBe(0);
    expect(observedCatalog).toMatchObject({
      canonicalInstructions: { complete: true, entries: expect.any(Array) },
    });
    const response = JSON.parse(messages.join("")) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(response.hookSpecificOutput.additionalContext).toContain(
      "durableInstructionStatus: applied",
    );
    const files = await readdir(resolve(root, "docs/instructions/generated"));
    expect(files).toHaveLength(1);
    const content = await readFile(resolve(root, "docs/instructions/generated", files[0]!), "utf8");
    expect(content).toContain("Use Conventional Commits for every repository commit.");
    expect(content).not.toContain(prompt);
    const storage = await openProjectStorage(root);
    try {
      expect(
        storage.events
          .list()
          .some(
            (event) =>
              event.type === "knowledge.materialization.applied" &&
              event.payload.operation === "durable_instruction_intake",
          ),
      ).toBe(true);
    } finally {
      await storage.close();
    }

    await applyKnowledgeMigrationPlan(
      await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" }),
      new Date("2026-08-30T00:00:00.000Z"),
      () => undefined,
    );
    const retrievalMessages: string[] = [];
    expect(
      await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], {
        cwd: root,
        stdout: (message) => retrievalMessages.push(message),
        stderr: () => undefined,
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "durable-rule-reader-session",
            turn_id: "durable-rule-reader-turn",
            prompt: "Prepare the next commit using Conventional Commits.",
          }),
      }),
    ).toBe(0);
    const retrieval = JSON.parse(retrievalMessages.join("")) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(retrieval.hookSpecificOutput.additionalContext).toContain(
      `docs/instructions/generated/${files[0]}`,
    );
    expect(retrieval.hookSpecificOutput.additionalContext).toContain(
      "Use Conventional Commits for every repository commit.",
    );
    expect(retrieval.hookSpecificOutput.additionalContext).not.toContain(
      "immutable blue envelopes",
    );
  }, 30_000);

  it("returns bounded abstain context instead of blocking on an invalid provider proposal", async () => {
    const root = await initializedRepository();
    const messages: string[] = [];
    const errors: string[] = [];
    expect(
      await runCli(
        ["terminal", "hook", "--provider", "codex", "--contract", "2"],
        {
          cwd: root,
          stdout: (message) => messages.push(message),
          stderr: (message) => errors.push(message),
          stdin: async () =>
            JSON.stringify({
              hook_event_name: "UserPromptSubmit",
              session_id: "invalid-provider-proposal-session",
              turn_id: "invalid-provider-proposal-turn",
              prompt: "뭐가 문제일까요",
            }),
        },
        {
          groundProductionRequest: async () => {
            throw new GroundProductionRequestError(
              new TypeError("references[0] contains unsupported or missing fields."),
            );
          },
        },
      ),
      errors.join(""),
    ).toBe(0);
    expect(errors).toEqual([]);
    const result = JSON.parse(messages.join("")) as {
      decision?: string;
      hookSpecificOutput?: { additionalContext: string };
    };
    expect(result.decision).toBeUndefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain(
      "groundingStatus: abstain; workflowId: none; reasons: semantic_resolution_failed",
    );
    expect(result.hookSpecificOutput?.additionalContext).toContain(
      "No matching publication was found.",
    );
  });

  it("checkpoints an attached worker without requiring foreign global lifecycle updates", async () => {
    const fixture = await managedWorkerRepository();
    const invoke = async (event: "UserPromptSubmit" | "Stop", turnId: string) => {
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
                    session_id: "managed-worker-provider-session",
                    turn_id: turnId,
                    prompt: "Update the assigned document.",
                  }
                : {
                    hook_event_name: event,
                    session_id: "managed-worker-provider-session",
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

    await invoke("UserPromptSubmit", "worker-turn-2");
    await writeFile(resolve(fixture.workspacePath, "outside-scope.txt"), "foreign\n");
    const blocked = await invoke("Stop", "worker-turn-2");
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
    const approvals = (plan: Awaited<ReturnType<typeof migrate>>) =>
      plan.userUpdates !== undefined
        ? plan.userUpdates.flatMap((item) => [
            "--approve-item",
            `${item.operationId}=${item.approvalHash}`,
          ])
        : plan.approvalHash === undefined || plan.approvalHash === null
          ? []
          : ["--approve-item", `${plan.operationId}=${plan.approvalHash}`];
    const terminalPlan = async () => {
      for (let index = 0; index < 10; index += 1) {
        const plan = await migrate();
        if (plan.planKind === "terminal_integration") return plan;
        await migrate("--apply", plan.planId, ...approvals(plan));
      }
      throw new Error("Terminal integration plan did not become reachable.");
    };

    const first = await terminalPlan();
    expect(["ready", "review_required"]).toContain(first.status);
    await migrate("--apply", first.planId, ...approvals(first));
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

  it("requires agent-authored continuation checkpoints only when repository bytes change", async () => {
    const root = await initializedRepository();
    const commandErrors: string[] = [];
    const quiet = {
      cwd: root,
      stdout: () => undefined,
      stderr: (message: string) => commandErrors.push(message),
    };
    const prompt = async (turnId: string) => {
      const messages: string[] = [];
      expect(
        await runCli(["terminal", "hook", "--provider", "claude", "--contract", "2"], {
          ...quiet,
          stdout: (message) => messages.push(message),
          stdin: async () =>
            JSON.stringify({
              hook_event_name: "UserPromptSubmit",
              session_id: "continuity-session",
              turn_id: turnId,
              prompt: "Continue the repository task.",
            }),
        }),
      ).toBe(0);
      return JSON.parse(messages.join("")).hookSpecificOutput.additionalContext as string;
    };
    const stop = async (turnId: string) => {
      const messages: string[] = [];
      expect(
        await runCli(["terminal", "hook", "--provider", "claude", "--contract", "2"], {
          ...quiet,
          stdout: (message) => messages.push(message),
          stdin: async () =>
            JSON.stringify({
              hook_event_name: "Stop",
              session_id: "continuity-session",
              turn_id: turnId,
              last_assistant_message: "Done.",
            }),
        }),
      ).toBe(0);
      return JSON.parse(messages.join("")) as { decision?: string; reason?: string };
    };
    const declare = async (context: string, taskMode: "change" | "continuation") => {
      const observation = context.match(/--observation (tobs_[A-Za-z0-9_-]+)/u)?.[1];
      expect(observation).toMatch(/^tobs_/u);
      const declaration = JSON.stringify({
        taskMode,
        canonicalizationDisposition: "canonical_sources_current",
        knowledgeDisposition: "current",
        deliberationDisposition: "not_requested",
        deliberationId: null,
      });
      expect(
        await runCli(
          ["terminal", "declare", "--provider", "claude", "--observation", observation!, "--stdin"],
          {
            ...quiet,
            stdin: async () => declaration,
          },
        ),
        commandErrors.join(""),
      ).toBe(0);
    };
    expect(await prompt("turn-read-only")).toContain("must create a bounded checkpoint");
    expect((await stop("turn-read-only")).reason ?? "").not.toMatch(
      /workstream_(?:missing|checkpoint_required)/u,
    );

    const startContext = await prompt("turn-start");
    expect(startContext).toContain("must create a bounded checkpoint");
    await writeFile(resolve(root, "feature.ts"), "export const firstCheckpoint = true;\n");
    expect(await stop("turn-start")).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("workstream_missing"),
    });

    const draft = JSON.stringify({
      schemaVersion: 1,
      status: "active",
      title: "Continuity fixture",
      objective: "Keep provider turns resumable.",
      nextActions: ["Advance the next revision."],
      blockers: [],
      notes: [],
      references: [],
      updatedAt: "2026-08-24T04:00:00.000Z",
    });
    const startPlanOutput: string[] = [];
    expect(
      await runCli(
        ["workstream", "start", "--actor", "agent", "--provider", "claude", "--stdin", "--json"],
        { ...quiet, stdin: async () => draft, stdout: (message) => startPlanOutput.push(message) },
      ),
    ).toBe(0);
    const startPlan = JSON.parse(startPlanOutput.join("")) as { planId: string };
    expect(
      await runCli(
        [
          "workstream",
          "start",
          "--actor",
          "agent",
          "--provider",
          "claude",
          "--stdin",
          "--apply",
          startPlan.planId,
        ],
        { ...quiet, stdin: async () => draft },
      ),
      commandErrors.join(""),
    ).toBe(0);
    expect(await stop("turn-start")).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("turn_declaration_missing"),
    });
    await declare(startContext, "change");
    const canonicalizationCandidates = await listCanonicalizationCandidates(root);
    expect(canonicalizationCandidates).toEqual([
      expect.objectContaining({
        observedState: "candidate",
        sourceBindings: [
          expect.objectContaining({
            path: "feature.ts",
            responsibility: "architecture_or_specification",
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(canonicalizationCandidates)).not.toMatch(/keyword|prompt|phrase/iu);
    expect((await stop("turn-start")).reason ?? "").not.toMatch(
      /(?:workstream_(?:missing|checkpoint_required)|turn_declaration_)/u,
    );

    const updateContext = await prompt("turn-update");
    expect(updateContext).toContain("revision: 1");
    await writeFile(resolve(root, "feature.ts"), "export const secondCheckpoint = true;\n");
    expect(await stop("turn-update")).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("workstream_checkpoint_required"),
    });
    const currentOutput: string[] = [];
    expect(
      await runCli(["workstream", "current", "--json"], {
        ...quiet,
        stdout: (message) => currentOutput.push(message),
      }),
    ).toBe(0);
    const current = JSON.parse(currentOutput.join("")).workstream as Record<string, unknown>;
    const desired = JSON.stringify({
      ...current,
      revision: 2,
      updatedAt: "2026-08-24T04:01:00.000Z",
    });
    const updatePlanOutput: string[] = [];
    expect(
      await runCli(
        ["workstream", "update", "--actor", "agent", "--provider", "claude", "--stdin", "--json"],
        {
          ...quiet,
          stdin: async () => desired,
          stdout: (message) => updatePlanOutput.push(message),
        },
      ),
    ).toBe(0);
    const updatePlan = JSON.parse(updatePlanOutput.join("")) as { planId: string };
    expect(
      await runCli(
        [
          "workstream",
          "update",
          "--actor",
          "agent",
          "--provider",
          "claude",
          "--stdin",
          "--apply",
          updatePlan.planId,
        ],
        { ...quiet, stdin: async () => desired },
      ),
    ).toBe(0);
    await declare(updateContext, "continuation");
    expect((await stop("turn-update")).reason ?? "").not.toMatch(
      /(?:workstream_(?:missing|checkpoint_required)|turn_declaration_)/u,
    );

    const storage = await openProjectStorage(root);
    try {
      const recorded = storage.events
        .list()
        .filter((event) => event.type === "workstream.snapshot.recorded");
      expect(recorded.slice(-2)).toMatchObject([
        {
          actor: { kind: "agent", provider: "claude" },
          payload: { changeKind: "agent_start", revision: 1 },
        },
        {
          actor: { kind: "agent", provider: "claude" },
          payload: { changeKind: "agent_update", revision: 2 },
        },
      ]);
    } finally {
      await storage.close();
    }
  }, 15_000);

  it("injects the structured current workstream independently of lexical knowledge hits", async () => {
    const root = await initializedRepository();
    await writeFile(
      resolve(root, "HANDOFF.md"),
      "# Active launch handoff\n\n## Current objective\n\nFinish the cobalt launch gate.\n\n## Next actions\n\n- Verify the device build.\n",
    );
    const migrationOutput: string[] = [];
    expect(
      await runCli(["migrate", "knowledge", "--json"], {
        cwd: root,
        stdout: (message) => migrationOutput.push(message),
        stderr: () => undefined,
      }),
    ).toBe(0);
    const migration = JSON.parse(migrationOutput.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
    };
    expect(
      await runCli(
        [
          "migrate",
          "knowledge",
          "--apply",
          migration.planId,
          "--approve-item",
          `${migration.operationId}=${migration.approvalHash}`,
        ],
        { cwd: root, stdout: () => undefined, stderr: () => undefined },
      ),
    ).toBe(0);
    const messages: string[] = [];
    const errors: string[] = [];
    expect(
      await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], {
        cwd: root,
        stdout: (message) => messages.push(message),
        stderr: (message) => errors.push(message),
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "workstream-session",
            turn_id: "turn-workstream",
            prompt: "unrelated lexical phrase",
          }),
      }),
      errors.join(""),
    ).toBe(0);
    const output = JSON.parse(messages.join("")) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(output.hookSpecificOutput.additionalContext).toContain("## Lervo current workstream");
    expect(output.hookSpecificOutput.additionalContext).toContain("Finish the cobalt launch gate.");
    const activation = JSON.parse(
      await readFile(
        resolve(root, ".lervo/state/terminal-integration/codex-user-prompt-submit.json"),
        "utf8",
      ),
    );
    const recorded = await openProjectStorage(root);
    try {
      expect(recorded.events.get(activation.observationEventId)?.payload).toMatchObject({
        workstreamId: expect.stringMatching(/^wks_/u),
        workstreamRevision: 1,
        workstreamSnapshotHash: expect.stringMatching(/^sha256:/u),
        workstreamScope: "full",
      });
    } finally {
      await recorded.close();
    }
    expect(errors).toEqual([]);
  });

  it("injects exact-hash Lervo query results for a natural provider prompt from a repository subtree", async () => {
    const root = await initializedRepository();
    await mkdir(resolve(root, "packages/fixture"), { recursive: true });
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: resolve(root, "packages/fixture"),
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
      stdin: async () =>
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "codex-session-fixture",
          turn_id: "turn-1",
          prompt: "atlas cache envelopes",
        }),
    };
    expect(
      await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], io),
      errors.join(""),
    ).toBe(0);
    const output = JSON.parse(messages.join("")) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(output.hookSpecificOutput.additionalContext).toContain("README.md");
    expect(output.hookSpecificOutput.additionalContext).toContain("immutable blue envelopes");
    expect(output.hookSpecificOutput.additionalContext).toContain(
      "This proves hook-side preparation, not provider acceptance, managed delivery",
    );
    expect(output.hookSpecificOutput.additionalContext).not.toContain("This proves delivery");
    expect(output.hookSpecificOutput.additionalContext).toMatch(/contentHash=sha256:[a-f0-9]{64}/u);
    expect(output.hookSpecificOutput.additionalContext).toMatch(
      /Lervo evidence marker: <!-- lervo-ref:concept_[a-f0-9]{24}:sha256:[a-f0-9]{64} -->/u,
    );
    expect(output.hookSpecificOutput.additionalContext).toContain(
      "standalone Markdown HTML comment",
    );
    expect(Buffer.byteLength(output.hookSpecificOutput.additionalContext)).toBeLessThanOrEqual(
      28 * 1024,
    );
    const activation = JSON.parse(
      await readFile(
        resolve(root, ".lervo/state/terminal-integration/codex-user-prompt-submit.json"),
        "utf8",
      ),
    );
    expect(activation).toMatchObject({
      provider: "codex",
      hookEvent: "UserPromptSubmit",
      result: "context_prepared",
      loadedDocumentCount: expect.any(Number),
      observationEventId: expect.stringMatching(/^evt_/u),
    });
    expect(activation.queryDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(activation)).not.toContain("atlas cache envelopes");
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events.get(activation.observationEventId as string);
      expect(event).toMatchObject({
        type: "terminal.context.prepared",
        actor: { kind: "provider", provider: "codex" },
      });
      expect(JSON.stringify(event)).not.toContain("atlas cache envelopes");
      expect(JSON.stringify(event)).not.toContain("codex-session-fixture");
    } finally {
      await storage.close();
    }
    const statusMessages: string[] = [];
    expect([0, 1]).toContain(
      await runCli(["terminal", "status", "--json"], {
        cwd: root,
        stdout: (message: string) => statusMessages.push(message),
        stderr: (message: string) => errors.push(message),
      }),
    );
    const status = JSON.parse(statusMessages.join("")) as {
      runtimeActivation: {
        status: string;
        evidenceMeaning: string;
        observations: Array<{ provider: string; hookEvent: string; status: string }>;
      };
      activationReadiness: {
        status: string;
        actions: Array<{ provider: string; code: string; instruction: string }>;
      };
    };
    expect(status.runtimeActivation.status).toBe("partial");
    expect(status.runtimeActivation.evidenceMeaning).toBe(
      "hook_endpoint_observed_not_provider_authorship",
    );
    expect(status.runtimeActivation.observations).toContainEqual({
      provider: "codex",
      hookEvent: "UserPromptSubmit",
      status: "observed",
      occurredAt: expect.any(String),
    });
    expect(status.activationReadiness).toMatchObject({
      status: "action_required",
      actions: expect.arrayContaining([
        expect.objectContaining({
          provider: "codex",
          instruction: expect.stringContaining("run /hooks"),
        }),
        expect.objectContaining({ provider: "claude" }),
      ]),
    });
    expect(errors).toEqual([]);
  }, 30_000);

  it("bounds provider context by UTF-8 bytes without splitting a multibyte character", async () => {
    const root = await initializedRepository();
    await writeFile(
      resolve(root, "README.md"),
      `# Unicode ceiling\n\nneedle ${"🧭".repeat(30_000)}\n`,
    );
    const refreshed = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
    await applyKnowledgeMigrationPlan(refreshed, new Date(), () => undefined);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
      stdin: async () =>
        JSON.stringify({
          hook_event_name: "UserPromptSubmit",
          session_id: "codex-session-unicode",
          turn_id: "turn-2",
          prompt: "unicode ceiling needle",
        }),
    };
    expect(
      await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], io),
      errors.join(""),
    ).toBe(0);
    const output = JSON.parse(messages.join("")) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(Buffer.byteLength(output.hookSpecificOutput.additionalContext)).toBeLessThanOrEqual(
      28 * 1024,
    );
    expect(output.hookSpecificOutput.additionalContext).toContain("[Lervo content truncated]");
    expect(output.hookSpecificOutput.additionalContext).not.toContain("�");
    expect(errors).toEqual([]);
  });

  it("blocks provider completion when durable source bytes make the knowledge lifecycle stale", async () => {
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
    const output = JSON.parse(messages.join("")) as { decision: string; reason: string };
    expect(output.decision).toBe("block");
    expect(output.reason).toMatch(
      /(?:repository_knowledge_|claude_instruction_bridge_|document_normalization_)/u,
    );
    expect(output.reason).toContain("lervo migrate knowledge");
    expect(
      JSON.parse(
        await readFile(resolve(root, ".lervo/state/terminal-integration/claude-stop.json"), "utf8"),
      ),
    ).toMatchObject({
      provider: "claude",
      hookEvent: "Stop",
      result: "completion_blocked",
      referenceCount: 0,
      observationEventId: expect.stringMatching(/^evt_/u),
    });
    expect(errors).toEqual([]);
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

  it("surfaces a bounded repository error when lifecycle planning fails", async () => {
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
    const output = JSON.parse(messages.join("")) as { decision: string; reason: string };
    expect(output.decision).toBe("block");
    expect(output.reason).toContain("repository_layout_inspection_failed");
    expect(output.reason).toContain("knowledge_concept_registry_incomplete");
    expect(output.reason).toContain("The knowledge concept registry is incomplete");
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

  it("fails closed on malformed hook input without echoing it", async () => {
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
    expect(await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], io)).toBe(
      2,
    );
    expect(messages).toEqual([]);
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
    expect(recovery).toMatchObject({
      exitCode: 0,
      output: {
        decision: "block",
        reason: expect.stringContaining("no matching start observation"),
      },
      errors: [],
    });
    const continued = await invoke(true);
    expect(continued).toEqual({ exitCode: 0, output: {}, errors: [] });
    await expect(
      access(resolve(root, ".lervo/state/terminal-integration/codex-stop.json")),
    ).rejects.toThrow();
  });

  it("projects explicit unmanaged references without claiming managed delivery or internal use", async () => {
    const root = await initializedRepository();
    const promptMessages: string[] = [];
    const promptErrors: string[] = [];
    expect(
      await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], {
        cwd: root,
        stdout: (message: string) => promptMessages.push(message),
        stderr: (message: string) => promptErrors.push(message),
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "private-provider-session",
            turn_id: "turn-coverage",
            prompt: "atlas cache envelopes",
          }),
      }),
      promptErrors.join(""),
    ).toBe(0);
    const context = (
      JSON.parse(promptMessages.join("")) as { hookSpecificOutput: { additionalContext: string } }
    ).hookSpecificOutput.additionalContext;
    const marker = context.match(
      /<!-- lervo-ref:concept_[a-f0-9]{24}:sha256:[a-f0-9]{64} -->/u,
    )?.[0];
    expect(marker).toBeDefined();

    const assistantMessage = `I relied on the repository publication.\n\n${marker}\nprivate response text`;
    const stopErrors: string[] = [];
    expect(
      await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], {
        cwd: root,
        stdout: () => undefined,
        stderr: (message: string) => stopErrors.push(message),
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "Stop",
            session_id: "private-provider-session",
            turn_id: "turn-coverage",
            last_assistant_message: assistantMessage,
          }),
      }),
      stopErrors.join(""),
    ).toBe(0);

    const reportMessages: string[] = [];
    expect(
      await runCli(["terminal", "coverage", "--provider", "codex", "--limit", "1", "--json"], {
        cwd: root,
        stdout: (message: string) => reportMessages.push(message),
        stderr: (message: string) => stopErrors.push(message),
      }),
      stopErrors.join(""),
    ).toBe(0);
    const report = JSON.parse(reportMessages.join("")) as {
      reports: Array<{
        executionMode: string;
        capabilities: {
          providerContextAcceptance: string;
          internalUse: string;
          explicitOutputReference: string;
        };
        coverage: {
          managedDelivery: { value: number | null; reason: string | null };
          explicitReference: { numerator: number };
        };
        documents: Array<{ highestObservation: string }>;
      }>;
    };
    expect(report.reports[0]).toMatchObject({
      executionMode: "unmanaged",
      capabilities: {
        providerContextAcceptance: "unsupported",
        internalUse: "unsupported",
        explicitOutputReference: "observed",
      },
      coverage: {
        managedDelivery: { value: null, reason: "unmanaged_no_adapter_receipt" },
        explicitReference: { numerator: 1 },
      },
    });
    expect(
      report.reports[0]?.documents.some((document) => document.highestObservation === "referenced"),
    ).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      const persisted = JSON.stringify(storage.events.list({ limit: 1000 }));
      expect(persisted).not.toContain("private-provider-session");
      expect(persisted).not.toContain("private response text");
    } finally {
      await storage.close();
    }
  });

  it("migrates existing Claude settings through the normal knowledge command without replacing existing hooks", async () => {
    const root = await initializedRepository();
    await writeFile(
      resolve(root, ".claude/settings.json"),
      '{"permissions":{"deny":["Bash"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"existing-stop"}]}]}}\n',
    );
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["migrate", "knowledge", "--json"], io), errors.join("")).toBe(0);
    const intermediate = JSON.parse(messages.join("")) as {
      planId: string;
      operations: Array<{ action: string }>;
      userUpdates?: Array<{ operationId: string; approvalHash: string }>;
    };
    if (intermediate.operations?.some((item) => item.action !== "unchanged")) {
      messages.length = 0;
      expect(
        await runCli(
          [
            "migrate",
            "knowledge",
            "--apply",
            intermediate.planId,
            ...(intermediate.userUpdates ?? []).flatMap((item) => [
              "--approve-item",
              `${item.operationId}=${item.approvalHash}`,
            ]),
            "--json",
          ],
          io,
        ),
        errors.join(""),
      ).toBe(0);
      messages.length = 0;
      expect(await runCli(["migrate", "knowledge", "--json"], io), errors.join("")).toBe(0);
    }
    const plan = JSON.parse(messages.join("")) as {
      planKind: string;
      planId: string;
      operationId: string;
      approvalHash: string;
    };
    expect(plan.planKind).toBe("terminal_integration");
    messages.length = 0;
    expect(
      await runCli(
        [
          "migrate",
          "knowledge",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
      errors.join(""),
    ).toBe(0);
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
  }, 15_000);
});
