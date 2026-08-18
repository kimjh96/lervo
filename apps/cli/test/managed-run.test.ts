import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  ClaudeAdapter,
  type ClaudeAgentClient,
  type ClaudeToolUseHandler,
} from "@lervo/adapter-claude";
import {
  CodexAdapter,
  type CodexAppServerClient,
  type CodexThreadStartOptions,
} from "@lervo/adapter-codex";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { validateSchema, type SkillManifest } from "@lervo/schemas";
import { hashSkillPackage } from "@lervo/skills";
import { afterEach, describe, expect, it } from "vitest";

import { createManagedRunExecutor, type RunProvider } from "../src/managed-run.js";
import { runCli } from "../src/main.js";

const CLAUDE_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CLAUDE_TURN_ID = "22222222-2222-4222-8222-222222222222";
const temporaryRoots: string[] = [];

class MessageQueue {
  private readonly values: unknown[] = [];
  private wake: (() => void) | undefined;

  push(...values: unknown[]): void {
    this.values.push(...values);
    this.wake?.();
    this.wake = undefined;
  }

  async *iterate(signal: AbortSignal): AsyncIterable<unknown> {
    let index = 0;
    while (!signal.aborted) {
      if (index < this.values.length) {
        yield structuredClone(this.values[index++]);
        continue;
      }
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        this.wake = done;
        signal.addEventListener("abort", done, { once: true });
      });
    }
  }
}

class ManagedCodexClient implements CodexAppServerClient {
  readonly queue = new MessageQueue();
  readonly startOptions: CodexThreadStartOptions[] = [];
  closed = false;

  constructor(
    private readonly root: string,
    private readonly failStart = false,
  ) {
    this.queue.push({
      method: "thread/started",
      params: { thread: { id: "codex-cli-session" } },
    });
  }

  async startThread(options: CodexThreadStartOptions) {
    if (this.failStart) throw new Error("fixture start failure");
    this.startOptions.push(structuredClone(options));
    return { threadId: "codex-cli-session" };
  }

  async injectItems() {}

  async startTurn(threadId: string) {
    setImmediate(() => {
      this.queue.push(
        {
          method: "turn/started",
          params: { threadId, turn: { id: "codex-cli-turn" } },
        },
        {
          method: "item/started",
          params: {
            threadId,
            turnId: "codex-cli-turn",
            item: {
              type: "fileChange",
              id: "codex-cli-write",
              status: "inProgress",
              changes: [{
                path: resolve(this.root, "src/result.ts"),
                kind: { type: "add" },
                diff: "private fixture diff",
              }],
            },
          },
        },
        {
          id: "codex-cli-approval",
          method: "item/fileChange/requestApproval",
          params: {
            threadId,
            turnId: "codex-cli-turn",
            itemId: "codex-cli-write",
          },
        },
      );
    });
    return { turnId: "codex-cli-turn" };
  }

  async respondFileChangeApproval(
    _requestId: string | number,
    decision: "accept" | "decline",
  ) {
    if (decision !== "accept") return;
    await writeFile(resolve(this.root, "src/result.ts"), "export const cli = true;\n");
    this.queue.push(
      {
        method: "item/completed",
        params: {
          threadId: "codex-cli-session",
          turnId: "codex-cli-turn",
          item: {
            type: "fileChange",
            id: "codex-cli-write",
            status: "completed",
            changes: [{
              path: resolve(this.root, "src/result.ts"),
              kind: { type: "add" },
              diff: "private fixture diff",
            }],
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "codex-cli-session",
          turnId: "codex-cli-turn",
          item: { type: "agentMessage", id: "codex-cli-result", text: "CLI 작업 완료" },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "codex-cli-session",
          turn: { id: "codex-cli-turn", status: "completed", durationMs: 1 },
        },
      },
    );
  }

  async interruptTurn() {}
  async unsubscribe() {}
  notifications(signal: AbortSignal) {
    return this.queue.iterate(signal);
  }
  async close() {
    this.closed = true;
  }
}

class ManagedClaudeClient implements ClaudeAgentClient {
  readonly queue = new MessageQueue();
  closed = false;
  private handler: ClaudeToolUseHandler | undefined;

  constructor(private readonly root: string) {}

  attachToolUseHandler(handler: ClaudeToolUseHandler): void {
    this.handler = handler;
  }

  async appendContext() {
    this.queue.push({
      type: "system",
      subtype: "init",
      session_id: CLAUDE_SESSION_ID,
      uuid: "33333333-3333-4333-8333-333333333333",
    });
  }

  async startTurn(turnId: string, instructions: string) {
    const toolInput = {
      file_path: resolve(this.root, "src/result.ts"),
      content: "export const cli = true;\n",
    };
    const allowed = await this.handler?.authorize(
      "Write",
      toolInput,
      "claude-cli-write",
    );
    if (allowed !== true) throw new Error("fixture write denied");
    await writeFile(toolInput.file_path, toolInput.content);
    await this.handler?.complete(
      "Write",
      toolInput,
      "claude-cli-write",
      "completed",
    );
    this.queue.push(
      {
        type: "user",
        isReplay: true,
        shouldQuery: true,
        uuid: turnId,
        session_id: CLAUDE_SESSION_ID,
        message: { role: "user", content: instructions },
        parent_tool_use_id: null,
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        user_message_uuid: turnId,
        uuid: "44444444-4444-4444-8444-444444444444",
        session_id: CLAUDE_SESSION_ID,
        duration_ms: 1,
        result: "CLI 작업 완료",
      },
    );
  }

  async interrupt() {}
  messages(signal: AbortSignal) {
    return this.queue.iterate(signal);
  }
  async close() {
    this.closed = true;
  }
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-run-"));
  temporaryRoots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_cli_run_0001",
      now: new Date("2026-08-19T00:00:00Z"),
    }),
  );
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "AGENTS.md"), "선언된 파일 하나만 변경합니다.\n");
  return root;
}

async function createProjectSkill(root: string): Promise<{
  manifest: SkillManifest;
  original: string;
  path: string;
}> {
  const path = resolve(root, ".agents/skills/repository-testing");
  await mkdir(path, { recursive: true });
  const original = "# 저장소 테스트\n원본 스킬 문서입니다.\n";
  await writeFile(resolve(path, "SKILL.md"), original);
  const manifest: SkillManifest = {
    schemaVersion: 1,
    skillId: "repository/testing",
    version: "1.2.0",
    contentHash: await hashSkillPackage(path),
    source: {
      kind: "project",
      uri: ".agents/skills/repository-testing",
      publisher: { id: "local-fixture", name: "Local Fixture" },
    },
    supportedRoles: ["developer"],
    compatibility: {
      providers: { mode: "allowlist", providers: ["codex"] },
      minimumRuntimeVersion: "0.1.0",
      platforms: [process.platform as "darwin" | "linux" | "win32"],
      requiredTools: ["shell"],
      unknownIsCompatible: false,
    },
    requiredCapabilities: ["filesystem.read", "shell.execute"],
    contracts: {
      inputSchemaRef: "lervo-schema://skill/input/v1",
      outputSchemaRef: "lervo-schema://skill/output/v1",
    },
    trust: { level: "untrusted", signatureStatus: "unsigned" },
    enabledScope: { kind: "user" },
    pinned: false,
  };
  await writeFile(resolve(path, "lervo-skill.json"), `${JSON.stringify(manifest)}\n`);
  return { manifest, original, path };
}

function identifierFactory(): (prefix: "run" | "ses" | "evt" | "ctx" | "envelope" | "turn") => string {
  let sequence = 0;
  return (prefix) => `${prefix}_cli${String(++sequence).padStart(8, "0")}`;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("lervo run vertical slice", () => {
  it.each(["codex", "claude"] as const)(
    "runs one managed %s change through project storage and the production adapter",
    async (provider) => {
      const root = await createRepository();
      const client =
        provider === "codex"
          ? new ManagedCodexClient(root)
          : new ManagedClaudeClient(root);
      const executeManagedRun = createManagedRunExecutor({
        openStorage: openProjectStorage,
        createId: identifierFactory(),
        createAdapter: ({ repositoryRoot, resolveArtifact }) =>
          provider === "codex"
            ? new CodexAdapter({
                repositoryRoot,
                resolveArtifact,
                clientFactory: async () => client as ManagedCodexClient,
              })
            : new ClaudeAdapter({
                repositoryRoot,
                resolveArtifact,
                clientFactory: async () => client as ManagedClaudeClient,
                createProviderSessionId: () => CLAUDE_SESSION_ID,
                createProviderMessageId: () => CLAUDE_TURN_ID,
              }),
      });
      let output = "";
      let errorOutput = "";
      const exitCode = await runCli(
        ["run", "--provider", provider, "--path", "src/result.ts", "작은 파일을 구현합니다"],
        {
          cwd: root,
          stdout: (message) => { output += message; },
          stderr: (message) => { errorOutput += message; },
        },
        { executeManagedRun },
      );

      expect(exitCode).toBe(0);
      expect(errorOutput).toBe("");
      expect(output).toContain("CLI 작업 완료");
      expect(output).toContain("기능 검증: 실행하지 않음");
      expect(await readFile(resolve(root, "src/result.ts"), "utf8"))
        .toBe("export const cli = true;\n");
      expect(client.closed).toBe(true);

      const storage = await openProjectStorage(root);
      const events = storage.events.list();
      await storage.close();
      expect(events.map((event) => event.type)).toContain("file.changed");
      expect(events.map((event) => event.type)).toContain("run.completed");
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain("작은 파일을 구현합니다");
      expect(serialized).not.toContain("CLI 작업 완료");
      expect(serialized).not.toContain("private fixture diff");
    },
  );

  it("locks and records a resolved skill without claiming invocation", async () => {
    const root = await createRepository();
    const skill = await createProjectSkill(root);
    const userSkillRoot = await mkdtemp(resolve(tmpdir(), "lervo-user-skills-"));
    temporaryRoots.push(userSkillRoot);
    const client = new ManagedCodexClient(root);
    const executeManagedRun = createManagedRunExecutor({
      openStorage: openProjectStorage,
      createId: identifierFactory(),
      userSkillRoot,
      now: () => new Date("2026-08-19T00:00:00Z"),
      createAdapter: ({ repositoryRoot, resolveArtifact }) =>
        new CodexAdapter({
          repositoryRoot,
          resolveArtifact,
          clientFactory: async () => client,
        }),
    });
    let output = "";
    let errorOutput = "";
    const exitCode = await runCli(
      [
        "run",
        "--provider",
        "codex",
        "--path",
        "src/result.ts",
        "--skill",
        skill.manifest.skillId,
        "스킬을 해석해 작업합니다",
      ],
      {
        cwd: root,
        stdout: (message) => { output += message; },
        stderr: (message) => { errorOutput += message; },
      },
      { executeManagedRun },
    );

    expect(exitCode).toBe(0);
    expect(errorOutput).toBe("");
    expect(output).toContain("repository/testing@1.2.0 (project)");
    expect(output).toContain("호출하거나 사용했다는 뜻이 아닙니다");
    expect(await readFile(resolve(skill.path, "SKILL.md"), "utf8")).toBe(skill.original);
    const lock: unknown = JSON.parse(await readFile(resolve(root, ".lervo/skills.lock"), "utf8"));
    expect(validateSchema("skillLock", lock).valid).toBe(true);
    expect(lock).toMatchObject({
      entries: [{
        skillId: "repository/testing",
        contentHash: skill.manifest.contentHash,
        source: { kind: "project", uri: ".agents/skills/repository-testing" },
      }],
    });

    const storage = await openProjectStorage(root);
    const events = storage.events.list();
    await storage.close();
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes.slice(0, 4)).toEqual([
      "run.requested",
      "run.resolved",
      "skill.resolved",
      "adapter.started",
    ]);
    expect(eventTypes).not.toContain("skill.invoked");
    expect(eventTypes).not.toContain("skill.completed");
    const resolved = events.find((event) => event.type === "skill.resolved");
    expect(resolved?.payload).toEqual({
      skillId: "repository/testing",
      source: "project",
      version: "1.2.0",
      contentHash: skill.manifest.contentHash,
      trustStatus: "untrusted",
    });
    expect(JSON.stringify(resolved)).not.toContain("Local Fixture");
    expect(JSON.stringify(resolved)).not.toContain(".agents/skills");
  });

  it("closes project storage after a provider startup failure", async () => {
    const root = await createRepository();
    const client = new ManagedCodexClient(root, true);
    let closeCount = 0;
    const executeManagedRun = createManagedRunExecutor({
      createId: identifierFactory(),
      openStorage: async (repositoryRoot) => {
        const storage = await openProjectStorage(repositoryRoot);
        return {
          ...storage,
          close: async () => {
            closeCount += 1;
            await storage.close();
          },
        };
      },
      createAdapter: ({ repositoryRoot, resolveArtifact }) =>
        new CodexAdapter({
          repositoryRoot,
          resolveArtifact,
          clientFactory: async () => client,
        }),
    });

    await expect(
      executeManagedRun({
        repositoryRoot: root,
        provider: "codex" as RunProvider,
        expectedPath: "src/result.ts",
        instructions: "실패 fixture",
        risk: "medium",
      }),
    ).rejects.toMatchObject({ code: "provider_start_failed" });
    expect(closeCount).toBe(1);
    expect(client.closed).toBe(true);
  });
});
