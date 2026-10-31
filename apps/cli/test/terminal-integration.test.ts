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
import {
  applyWorkspaceProvision,
  captureRepositorySnapshot,
  planWorkspaceProvision,
} from "@lervo/orchestrator";

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
  scanConfiguredRepositoryKnowledge,
  sha256,
  structuralConceptDirectory,
  terminalHookCommand,
} from "@lervo/repository-knowledge";
import { openProjectStorage, RepositoryCoordinationRecords } from "@lervo/project-storage";
import type { VerificationSuite } from "@lervo/schemas";
import {
  activateFixtureEventWriterV2,
  activateFixtureEventWriterV3,
} from "../../../packages/project/test/fixture-event-writer.js";
import { createSearchQueryProjection, searchQueryProjectorBuildId } from "@lervo/search";
import { runVerificationSuite } from "@lervo/verification";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { runCli as runCliBase } from "../src/main.js";
import { terminalTurnDeclarationRequired } from "../src/terminal-lifecycle-inspection.js";
import { terminalKnowledgeSnapshotId } from "../src/terminal-compact-context.js";
import { captureTerminalRepositorySnapshot } from "../src/terminal-repository-snapshot.js";
import { recordKnowledgeResidentHealth } from "@lervo/repository-knowledge-runtime";
import type { ProjectProductionSearchQueries } from "../src/provider-query-projector.js";

const testProjector = {
  id: "provider_query_projection.test",
  version: 1,
  buildId: searchQueryProjectorBuildId("terminal-integration-test-projector-v1"),
} as const;

function projectedQueries(
  input: Parameters<ProjectProductionSearchQueries>[0],
  queries: string[],
  status: "completed" | "empty" | "failed" = queries.length === 0 ? "empty" : "completed",
) {
  return createSearchQueryProjection({
    projector: testProjector,
    requestDigest: input.requestDigest,
    contextDigest: input.contextDigest,
    projectorResultDigest: `sha256:${"d".repeat(64)}`,
    requestedLanguage: input.requestedLanguage,
    queries,
    durationMs: 1,
    status,
  });
}

const runCli: typeof runCliBase = (args, io, overrides = {}) =>
  runCliBase(args, io, {
    prepareSearchQueries: undefined,
    projectSearchQueries: async (input) => projectedQueries(input, [input.request]),
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

// These cases pin the opt-in per-prompt retrieval contract; compact defaults are covered separately.
const previousContextMode = process.env.LERVO_TERMINAL_CONTEXT;
beforeAll(() => {
  process.env.LERVO_TERMINAL_CONTEXT = "retrieval";
});
afterAll(() => {
  if (previousContextMode === undefined) delete process.env.LERVO_TERMINAL_CONTEXT;
  else process.env.LERVO_TERMINAL_CONTEXT = previousContextMode;
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
            "search",
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

  it("uses query projection without invoking effect grounding or a separate admission path", async () => {
    const root = await initializedRepository();
    const calls: string[] = [];
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
              session_id: "prepared-search-session",
              turn_id: "prepared-search-turn",
              prompt: "Explain repository context.",
            }),
        },
        {
          projectSearchQueries: async (input) => {
            calls.push("project");
            return projectedQueries(input, [input.request]);
          },
          prepareSearchQueries: async () => {
            calls.push("prepare");
            throw new Error("Direct prompt preparation must not use a separate admission path.");
          },
          groundProductionRequest: async () => {
            calls.push("ground");
            throw new Error("Direct prompt preparation must not resolve effects.");
          },
        },
      ),
      errors.join(""),
    ).toBe(0);
    expect(messages).toHaveLength(1);
    expect(calls).toEqual(["project"]);
  });

  it("does not admit a query projector for Stop", async () => {
    const root = await initializedRepository();
    let preparations = 0;
    const messages: string[] = [];

    expect(
      await runCli(
        ["terminal", "hook", "--provider", "codex", "--contract", "2"],
        {
          cwd: root,
          stdout: (message) => messages.push(message),
          stderr: () => undefined,
          stdin: async () =>
            JSON.stringify({
              hook_event_name: "Stop",
              session_id: "stop-without-preparation-session",
              turn_id: "stop-without-preparation-turn",
              stop_hook_active: true,
            }),
        },
        {
          prepareSearchQueries: async () => {
            preparations += 1;
            throw new Error("Stop must not prepare search queries.");
          },
        },
      ),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toEqual({});
    expect(preparations).toBe(0);
  });

  it("does not materialize durable rules from direct unmanaged prompts", async () => {
    const root = await initializedRepository();
    const messages: string[] = [];
    const prompt = "앞으로 이 저장소의 모든 커밋은 Conventional Commits 형식을 따르세요.";
    let groundingCalls = 0;
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
          groundProductionRequest: async () => {
            groundingCalls += 1;
            throw new Error("Effect grounding must not run.");
          },
        },
      ),
    ).toBe(0);
    expect(groundingCalls).toBe(0);
    const response = JSON.parse(messages.join("")) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(response.hookSpecificOutput.additionalContext).toContain(
      "durableInstructionStatus: ignored",
    );
    expect(response.hookSpecificOutput.additionalContext).toContain(
      "Direct prompt preparation never materializes a repository rule",
    );
    expect(response.hookSpecificOutput.additionalContext).toContain(
      "lervo knowledge instruction intake --provider codex --stdin",
    );
    expect(response.hookSpecificOutput.additionalContext).not.toContain(prompt);
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
      ).toBe(false);
    } finally {
      await storage.close();
    }
  });

  it.each(["codex", "claude"] as const)(
    "returns bounded policy and local-scope context when query projection fails for %s",
    async (provider) => {
      const root = await initializedRepository();
      const messages: string[] = [];
      const errors: string[] = [];
      expect(
        await runCli(
          ["terminal", "hook", "--provider", provider, "--contract", "2"],
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
            projectSearchQueries: async (input) => projectedQueries(input, [], "failed"),
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
        "publication.language=en; writingPolicyId=writing_en-human",
      );
      expect(result.hookSpecificOutput?.additionalContext).toContain(
        "effectGroundingStatus: abstain; workflowId: none; reasons: unmanaged_terminal_retrieval_only",
      );
      expect(result.hookSpecificOutput?.additionalContext).toContain(
        "No current-repository publication was selected because query projection was unavailable.",
      );
      expect(result.hookSpecificOutput?.additionalContext).toContain(
        "selectionDisposition: query_projection_missing; candidates: 0; selected: 0",
      );
      expect(result.hookSpecificOutput?.additionalContext).toContain(
        "not evidence that content is absent from another repository",
      );
    },
  );

  it("keeps retrieval available and marks attention coverage unavailable for an unsafe candidate registry", async () => {
    const root = await initializedRepository();
    await mkdir(resolve(root, ".lervo/state/knowledge/canonicalization-candidates/not-safe"), {
      recursive: true,
    });
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
            session_id: "unsafe-attention-registry-session",
            turn_id: "unsafe-attention-registry-turn",
            prompt: "Explain the atlas cache.",
          }),
      }),
      errors.join(""),
    ).toBe(0);
    expect(errors).toEqual([]);
    const result = JSON.parse(messages.join("")) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(result.hookSpecificOutput.additionalContext).toContain("immutable blue envelopes");
    expect(result.hookSpecificOutput.additionalContext).toContain(
      "canonicalizationCoverage: unavailable",
    );
    expect(result.hookSpecificOutput.additionalContext).toContain(
      "Repository attention: action_required",
    );
  });

  it("allows prompt submission when local context preparation throws", async () => {
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
              session_id: "unavailable-projection-session",
              turn_id: "unavailable-projection-turn",
              prompt: "Inspect the shared report.",
            }),
        },
        {
          projectSearchQueries: async () => {
            throw new Error("Provider projection is unavailable.");
          },
        },
      ),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toEqual({});
    expect(errors).toEqual([]);
  });

  it("retrieves from a valid query projection without effect grounding", async () => {
    const root = await initializedRepository();
    const messages: string[] = [];
    let groundingCalls = 0;
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
              session_id: "clarify-projection-session",
              turn_id: "clarify-projection-turn",
              prompt: "그 내용을 확인해줘",
            }),
        },
        {
          projectSearchQueries: async (input) =>
            projectedQueries(input, ["atlas cache immutable blue envelopes"]),
          groundProductionRequest: async () => {
            groundingCalls += 1;
            throw new Error("Effect grounding must not run.");
          },
        },
      ),
    ).toBe(0);
    const result = JSON.parse(messages.join("")) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(result.hookSpecificOutput.additionalContext).toContain(
      "effectGroundingStatus: abstain; workflowId: none; reasons: unmanaged_terminal_retrieval_only",
    );
    expect(groundingCalls).toBe(0);
    expect(result.hookSpecificOutput.additionalContext).toContain("selectionDisposition: selected");
    expect(result.hookSpecificOutput.additionalContext).toContain("README.md");
    expect(result.hookSpecificOutput.additionalContext).toContain("immutable blue envelopes");
  });

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

  it("audits agent-authored continuation checkpoints without blocking unmanaged completion", async () => {
    const root = await initializedRepository();
    const commandErrors: string[] = [];
    const quiet = {
      cwd: root,
      stdout: () => undefined,
      stderr: (message: string) => commandErrors.push(message),
    };
    let rejectedUnsupportedKnowledgeClaim = false;
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
        canonicalizationOutcome: {
          schemaVersion: 1,
          kind: "no_durable_change",
          summary: "The fixture source change is intentionally implementation-only.",
          reasonCode: "implementation_only",
          sourcePaths: ["src/feature.ts"],
        },
        knowledgeDisposition: "pending_user_approval",
        deliberationDisposition: "not_requested",
        deliberationId: null,
      });
      if (!rejectedUnsupportedKnowledgeClaim) {
        expect(
          await runCli(
            [
              "terminal",
              "declare",
              "--provider",
              "claude",
              "--observation",
              observation!,
              "--stdin",
            ],
            {
              ...quiet,
              stdin: async () =>
                declaration.replace(
                  '"knowledgeDisposition":"pending_user_approval"',
                  '"knowledgeDisposition":"current"',
                ),
            },
          ),
        ).toBe(1);
        expect(commandErrors.join("")).toContain(
          "The declared knowledge disposition is not supported by the current repository lifecycle",
        );
        commandErrors.length = 0;
        rejectedUnsupportedKnowledgeClaim = true;
      }
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
    await mkdir(resolve(root, "src"));
    await writeFile(resolve(root, "src/feature.ts"), "export const firstCheckpoint = true;\n");
    expect(await stop("turn-start")).toEqual({});

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
    expect(await stop("turn-start")).toEqual({});
    await declare(startContext, "change");
    const canonicalizationCandidates = await listCanonicalizationCandidates(root);
    expect(canonicalizationCandidates).toEqual([
      expect.objectContaining({
        observedState: "candidate",
        sourceBindings: [
          expect.objectContaining({
            path: "src/feature.ts",
            responsibility: "architecture_or_specification",
          }),
        ],
        outcome: expect.objectContaining({
          kind: "no_durable_change",
          reasonCode: "implementation_only",
          sourcePaths: ["src/feature.ts"],
        }),
      }),
    ]);
    expect(JSON.stringify(canonicalizationCandidates)).not.toMatch(/keyword|prompt|phrase/iu);
    expect((await stop("turn-start")).reason ?? "").not.toMatch(
      /(?:workstream_(?:missing|checkpoint_required)|turn_declaration_)/u,
    );

    const updateContext = await prompt("turn-update");
    expect(updateContext).toContain("revision: 1");
    expect(updateContext).toContain("Repository attention: action_required");
    expect(updateContext).toContain("canonicalization_review:kcanon_");
    expect(updateContext).toContain(
      "Before claiming completion, resolve current agent-owned items that fall within this task.",
    );
    // No listed item is a current, user-owned blocking item, so no same-turn directive appears.
    expect(updateContext).not.toContain("present its bounded question or approval");
    await writeFile(resolve(root, "src/feature.ts"), "export const secondCheckpoint = true;\n");
    expect(await stop("turn-update")).toEqual({});
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
      preparationQuality: {
        retrieval: "completed",
        loading: "observed",
        delivery: "unobserved",
        applicability: "unobserved",
        internalUse: "unknown",
      },
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

  it("bounds provider context without substituting a truncated required passage", async () => {
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
    expect(output.hookSpecificOutput.additionalContext).not.toContain("[Lervo content truncated]");
    expect(output.hookSpecificOutput.additionalContext).toContain(
      "Some selected evidence was omitted",
    );
    expect(output.hookSpecificOutput.additionalContext).not.toContain("�");
    expect(errors).toEqual([]);
  });

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
    expect(recovery).toEqual({ exitCode: 0, output: {}, errors: [] });
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
    const budgetMessages: string[] = [];
    const budgetExit = await runCli(
      [
        "terminal",
        "budget",
        "--provider",
        "codex",
        "--limit",
        "1",
        "--minimum-samples",
        "1",
        "--json",
      ],
      {
        cwd: root,
        stdout: (message: string) => budgetMessages.push(message),
        stderr: (message: string) => stopErrors.push(message),
      },
    );
    const budgetReport = JSON.parse(budgetMessages.join(""));
    expect(budgetReport).toMatchObject({
      reportKind: "unmanaged_terminal_budget",
      disposition: "escalation_required",
      wholeTaskUsage: {
        status: "unsupported",
        reasonCode: "unmanaged_provider_usage_unobserved",
      },
      hookProfiles: [],
      queryProjections: [{ status: "not_configured" }],
    });
    expect(budgetExit, `${stopErrors.join("")}\n${JSON.stringify(budgetReport)}`).toBe(1);
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

  it("turns a completed result into an evidence-bound portable-skill candidate", async () => {
    const root = await initializedRepository();
    const initialStorage = await openProjectStorage(root);
    const projectId = initialStorage.manifest.projectId;
    await initialStorage.close();
    await activateFixtureEventWriterV2({
      repositoryRoot: root,
      projectId,
      observedAt: "2026-09-05T01:00:00.000Z",
    });
    await mkdir(resolve(root, "apps/example"), { recursive: true });
    await mkdir(resolve(root, "packages/example"), { recursive: true });
    await writeFile(resolve(root, "apps/example/a.ts"), "export const workflowA = 'checked';\n");
    await writeFile(
      resolve(root, "packages/example/b.ts"),
      "export const workflowB = 'checked';\n",
    );
    const workflowSuite = (suffix: "a" | "b"): VerificationSuite => ({
      schemaVersion: 1,
      suiteId: `workflow.${suffix}`,
      stopOnFailure: true,
      commands: [
        {
          commandId: `check.${suffix}`,
          executable: "node",
          arguments: ["-e", "process.exit(0)"],
          cwd: ".",
          timeoutMs: 5_000,
          maxOutputBytes: 4_096,
          environmentVariableNames: [],
        },
      ],
    });
    const workflowSuites = { a: workflowSuite("a"), b: workflowSuite("b") };
    await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
    await Promise.all(
      (["a", "b"] as const).map((suffix) =>
        writeFile(
          resolve(root, `.lervo/verifications/workflow.${suffix}.yaml`),
          `${JSON.stringify(workflowSuites[suffix], null, 2)}\n`,
        ),
      ),
    );
    const promptOutput: string[] = [];
    const promptErrors: string[] = [];
    expect(
      await runCli(["terminal", "hook", "--provider", "codex", "--contract", "2"], {
        cwd: root,
        stdout: (message) => promptOutput.push(message),
        stderr: (message) => promptErrors.push(message),
        stdin: async () =>
          JSON.stringify({
            hook_event_name: "UserPromptSubmit",
            session_id: "portable-skill-session",
            turn_id: "portable-skill-turn",
            prompt: "Complete the workflow and propose a reviewed reusable candidate.",
          }),
      }),
    ).toBe(0);
    const context = (
      JSON.parse(promptOutput.join("")) as {
        hookSpecificOutput?: { additionalContext: string };
      }
    ).hookSpecificOutput?.additionalContext;
    expect(context, `${promptErrors.join("")} ${promptOutput.join("")}`).toBeTypeOf("string");
    const observation = context!.match(/--observation (tobs_[A-Za-z0-9_-]+)/u)?.[1];
    expect(observation).toMatch(/^tobs_/u);

    const storage = await openProjectStorage(root);
    const verification = [];
    try {
      for (const suffix of ["a", "b"] as const) {
        const identity = `workflow${suffix.repeat(8)}`;
        const repositoryRevision = sha256(`revision-${suffix}`);
        let clock = Date.parse(`2026-09-05T01:0${suffix === "a" ? "1" : "2"}:00.000Z`);
        const completed = await runVerificationSuite(
          {
            repositoryRoot: root,
            repositoryRevision,
            suite: workflowSuites[suffix],
            artifactStore: storage.artifacts,
            captureRepositoryRevision: async () => repositoryRevision,
          },
          { now: () => new Date(clock++) },
        );
        const appended = storage.events.append({
          eventId: `evt_${identity}`,
          projectId: storage.manifest.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "verification.completed",
          occurredAt: completed.result.completedAt,
          actor: { kind: "system" },
          schemaVersion: 1,
          policyVersion: sha256(`policy-${suffix}`),
          payload: {
            verificationId: completed.result.verificationId,
            suiteId: completed.result.suiteId,
            suiteHash: completed.result.suiteHash,
            repositoryRevision: completed.result.repositoryRevision,
            status: completed.result.status,
            resultArtifactId: completed.resultArtifact.artifactId,
            resultContentHash: completed.resultArtifact.contentHash,
            nonPassedCommandIds: [],
          },
        }).event;
        verification.push({
          independentGroup: `workflow-${suffix}`,
          eventId: appended.eventId,
          eventHash: appended.eventHash,
          runId: appended.runId,
          verificationId: appended.payload.verificationId,
          suiteHash: appended.payload.suiteHash,
          repositoryRevision: appended.payload.repositoryRevision,
          resultContentHash: appended.payload.resultContentHash,
        });
      }
    } finally {
      await storage.close();
    }

    await writeFile(
      resolve(root, "apps/example/a.ts"),
      "export const workflowA = 'checked-with-evidence';\n",
    );
    const preparedSnapshot = JSON.parse(
      await readFile(
        resolve(root, `.lervo/state/terminal-integration/prepared-snapshots/${observation}.json`),
        "utf8",
      ),
    ) as { files: Record<string, string> };
    const currentSnapshot = await captureRepositorySnapshot(root);
    const changedPaths = [
      ...new Set([...Object.keys(preparedSnapshot.files), ...Object.keys(currentSnapshot.files)]),
    ].filter((path) => preparedSnapshot.files[path] !== currentSnapshot.files[path]);
    expect(changedPaths).toEqual(["apps/example/a.ts"]);
    const { scan } = await scanConfiguredRepositoryKnowledge(root);
    const workflowA = scan.units.find((unit) => unit.path === "apps/example/a.ts")!;
    const workflowB = scan.units.find((unit) => unit.path === "packages/example/b.ts")!;
    const declarationOutput: string[] = [];
    const declarationErrors: string[] = [];
    const proposal = {
      schemaVersion: 1,
      title: "Bounded workflow check",
      summary: "Reuse an independently verified workflow without granting publication authority.",
      scope: "repository workflow checks",
      occurrences: [
        { path: workflowA.path, locator: workflowA.locator, independentGroup: "workflow-a" },
        { path: workflowB.path, locator: workflowB.locator, independentGroup: "workflow-b" },
      ],
      exceptions: ["Publication remains a separate authority."],
      affectedInvariants: ["Verification and activation remain distinct."],
      reasonsToChange: ["Two independent workflow groups passed exact verification."],
      verificationCommands: ["pnpm quality:check"],
      target: {
        kind: "portable_skill",
        path: ".agents/skills/bounded-workflow-check/SKILL.md",
        content:
          "---\nname: bounded-workflow-check\ndescription: Run the bounded workflow checks.\n---\n\n# Bounded workflow check\n\nUse exact verification and retain separate publication authority.\n",
      },
      workflowVerification: verification,
      portableSkillContract: {
        skillId: "bounded-workflow-check",
        capabilityId: "repository/bounded_workflow_check",
        version: "1.0.0",
        supportedRoles: ["developer"],
        providerCompatibility: { mode: "any" },
        minimumRuntimeVersion: "0.11.4",
        platforms: ["darwin", "linux", "win32"],
        requiredTools: ["pnpm"],
        requiredCapabilities: ["filesystem.read", "shell.execute"],
        dependencies: [],
        inputSchemaRef: "lervo-schema://skill/input/v1",
        outputSchemaRef: "lervo-schema://skill/output/v1",
        resources: [
          {
            path: "references/checklist.md",
            content: "# Checklist\n\nRun the exact configured verification.\n",
            purpose: "Defines the reviewed workflow checklist.",
            required: true,
          },
        ],
      },
    };
    expect(
      await runCli(
        [
          "terminal",
          "declare",
          "--provider",
          "codex",
          "--observation",
          observation!,
          "--stdin",
          "--json",
        ],
        {
          cwd: root,
          stdout: (message) => declarationOutput.push(message),
          stderr: (message) => declarationErrors.push(message),
          stdin: async () =>
            JSON.stringify({
              taskMode: "change",
              canonicalizationDisposition: "pending_user_approval",
              canonicalizationOutcome: {
                schemaVersion: 1,
                kind: "portable_skill_candidate",
                summary: "The completed workflow produced a reviewable portable-skill candidate.",
                sourcePaths: ["apps/example/a.ts"],
                proposal,
              },
              knowledgeDisposition: "pending_user_approval",
              deliberationDisposition: "not_requested",
              deliberationId: null,
            }),
        },
      ),
      declarationErrors.join(""),
    ).toBe(0);
    const declared = JSON.parse(declarationOutput.join(""));
    expect(declared.canonicalizationAssessment).toMatchObject({
      status: "pending",
      candidate: null,
    });
    expect(declared.developmentPatternCandidate).toMatchObject({
      state: "candidate",
      targetKind: "portable_skill",
      occurrenceCount: 2,
    });
    const candidate = declared.developmentPatternCandidate as {
      patternId: string;
      candidateContentHash: string;
    };
    expect(
      await runCli(
        [
          "knowledge",
          "pattern",
          "review",
          candidate.patternId,
          "--decision",
          "accept",
          "--reviewer",
          "repository-maintainer",
          "--approval",
          candidate.candidateContentHash,
        ],
        { cwd: root, stdout: () => undefined, stderr: () => undefined },
      ),
    ).toBe(0);
    const promotionOutput: string[] = [];
    expect(
      await runCli(["knowledge", "pattern", "promote", candidate.patternId, "--json"], {
        cwd: root,
        stdout: (message) => promotionOutput.push(message),
        stderr: (message) => declarationErrors.push(message),
      }),
      declarationErrors.join(""),
    ).toBe(0);
    const promotion = JSON.parse(promotionOutput.join("")) as {
      planId: string;
      status: string;
      operations: Array<{ path: string }>;
    };
    expect(promotion).toMatchObject({ status: "ready" });
    expect(promotion.operations.map((operation) => operation.path)).toEqual([
      ".agents/skills/bounded-workflow-check/SKILL.md",
      ".agents/skills/bounded-workflow-check/references/checklist.md",
      ".agents/skills/bounded-workflow-check/lervo-skill.json",
      ".agents/skills/bounded-workflow-check/lervo-capability.json",
    ]);
    expect(JSON.stringify(promotion)).not.toContain("Run the exact configured verification");
    expect(
      await runCli(
        [
          "knowledge",
          "pattern",
          "promote",
          candidate.patternId,
          "--apply",
          "--approval",
          promotion.planId,
        ],
        { cwd: root, stdout: () => undefined, stderr: () => undefined },
      ),
    ).toBe(0);
    expect(
      await readFile(
        resolve(root, ".agents/skills/bounded-workflow-check/references/checklist.md"),
        "utf8",
      ),
    ).toContain("exact configured verification");
    const manifest = JSON.parse(
      await readFile(
        resolve(root, ".agents/skills/bounded-workflow-check/lervo-skill.json"),
        "utf8",
      ),
    );
    expect(manifest).toMatchObject({
      skillId: "bounded-workflow-check",
      trust: { level: "untrusted" },
      enabledScope: { kind: "disabled" },
      requiredCapabilities: ["filesystem.read", "shell.execute"],
      contracts: {
        inputSchemaRef: "lervo-schema://skill/input/v1",
        outputSchemaRef: "lervo-schema://skill/output/v1",
      },
    });

    const authorizationOutput: string[] = [];
    expect(
      await runCli(
        [
          "capability",
          "authorize-skill",
          "--skill",
          "bounded-workflow-check",
          "--reviewer",
          "repository-maintainer",
          "--json",
        ],
        {
          cwd: root,
          stdout: (message) => authorizationOutput.push(message),
          stderr: (message) => declarationErrors.push(message),
        },
      ),
      declarationErrors.join(""),
    ).toBe(0);
    const authorization = JSON.parse(authorizationOutput.join("")) as { planId: string };
    const authorizationPath = resolve(root, ".lervo/state/test-skill-authorization.json");
    await writeFile(authorizationPath, authorizationOutput.join(""));
    expect(
      await runCli(
        [
          "capability",
          "authorize-skill",
          "--from",
          authorizationPath,
          "--apply",
          "--approval",
          authorization.planId,
        ],
        { cwd: root, stdout: () => undefined, stderr: () => undefined },
      ),
    ).toBe(0);
    expect(
      JSON.parse(
        await readFile(
          resolve(root, ".agents/skills/bounded-workflow-check/lervo-skill.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      trust: { level: "reviewed", reviewedBy: "repository-maintainer" },
      enabledScope: { kind: "projects", projectIds: [projectId] },
    });

    const migrationOutput: string[] = [];
    expect(
      await runCli(["capability", "migrate", "--json"], {
        cwd: root,
        stdout: (message) => migrationOutput.push(message),
        stderr: (message) => declarationErrors.push(message),
      }),
      declarationErrors.join(""),
    ).toBe(0);
    const migration = JSON.parse(migrationOutput.join("")) as {
      planId: string;
      status: string;
    };
    expect(migration.status).toBe("ready");
    expect(
      await runCli(["capability", "migrate", "--apply", "--approval", migration.planId], {
        cwd: root,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    ).toBe(0);
  }, 15_000);
});

describe("compact terminal prompt context", () => {
  beforeAll(() => {
    process.env.LERVO_TERMINAL_CONTEXT = "compact";
  });
  afterAll(() => {
    process.env.LERVO_TERMINAL_CONTEXT = "retrieval";
  });

  it("records only delivered exact-anchor pointers without loading their bodies", async () => {
    const root = await initializedRepository();
    const path = "docs/decisions/0541-observe-turn.md";
    const body = "# ADR-0541: Observe the turn\n\nKeep reference evidence distinct from use.\n";
    await mkdir(resolve(root, "docs/decisions"), { recursive: true });
    await writeFile(resolve(root, path), body);
    let output = "";
    expect(
      await runCli(
        ["terminal", "hook", "--provider", "claude", "--contract", "2"],
        {
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
        },
        {
          projectSearchQueries: async () => {
            throw new Error("No provider call is allowed.");
          },
        },
      ),
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
          quiet,
        ),
      ).toBe(0);
      await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
      await writeFile(
        resolve(root, `docs/instructions/generated/rule_${"d".repeat(24)}.md`),
        "# Preserve examples\n\nRequired clause: preserve quoted source.\n\n## Exceptions\n\nTranslate only when explicitly requested.\n",
      );
      const messages: string[] = [];
      expect(
        await runCli(
          ["terminal", "hook", "--provider", provider, "--contract", "2"],
          {
            ...quiet,
            stdout: (message) => messages.push(message),
            stdin: async () =>
              JSON.stringify({
                hook_event_name: "UserPromptSubmit",
                session_id: "compact-session",
                turn_id: "turn-compact",
                prompt: "변경 내용을 문서로 정리해줘",
              }),
          },
          {
            projectSearchQueries: async () => {
              throw new Error("Compact prompts must not invoke a provider query projector.");
            },
          },
        ),
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
