import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { hashCapabilityFiles } from "@lervo/capabilities";
import type { CapabilityPackageManifest } from "@lervo/schemas";
import type { WritingSemanticEvaluator } from "@lervo/writing";
import { afterEach, describe, expect, it } from "vitest";

import { createManagedRunExecutor, type RunProvider } from "../src/managed-run.js";
import { resolveDefaultManagedLinkedEvidenceSelection } from "../src/managed-linked-evidence-default-selection.js";
import { collectLocalKnowledgeSources } from "../src/knowledge-sources.js";
import { runCli } from "../src/main.js";
import { registerLinkedSearchContextDocuments } from "./search-context-fixture.js";

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

  async listConnectedMcpServers() {
    const config = this.startOptions.at(-1)?.config as
      { mcp_servers?: Record<string, unknown> } | undefined;
    return Object.keys(config?.mcp_servers ?? {});
  }

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
              changes: [
                {
                  path: resolve(this.root, "src/result.ts"),
                  kind: { type: "add" },
                  diff: "private fixture diff",
                },
              ],
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

  async respondFileChangeApproval(_requestId: string | number, decision: "accept" | "decline") {
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
            changes: [
              {
                path: resolve(this.root, "src/result.ts"),
                kind: { type: "add" },
                diff: "private fixture diff",
              },
            ],
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "codex-cli-session",
          turnId: "codex-cli-turn",
          item: { type: "agentMessage", id: "codex-cli-result", text: "CLI task complete" },
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
    const allowed = await this.handler?.authorize("Write", toolInput, "claude-cli-write");
    if (allowed !== true) throw new Error("fixture write denied");
    await writeFile(toolInput.file_path, toolInput.content);
    await this.handler?.complete("Write", toolInput, "claude-cli-write", "completed");
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
        result: "CLI task complete",
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
  await writeFile(resolve(root, "AGENTS.md"), "Change only the declared file.\n");
  await writeVerificationSuite(root);
  return root;
}

async function writeVerificationSuite(
  root: string,
  script = "process.exit(require('node:fs').existsSync('src/result.ts') ? 0 : 1)",
): Promise<void> {
  await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
  await writeFile(
    resolve(root, ".lervo/verifications/project.default.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: project.default",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: verify-result",
      "    executable: node",
      "    arguments:",
      "      - -e",
      `      - ${JSON.stringify(script)}`,
      "    cwd: .",
      "    timeoutMs: 10000",
      "    maxOutputBytes: 4096",
      "    environmentVariableNames: []",
      "",
    ].join("\n"),
  );
}

async function createProjectSkill(root: string): Promise<{
  manifest: SkillManifest;
  original: string;
  path: string;
}> {
  const path = resolve(root, ".agents/skills/repository-testing");
  await mkdir(path, { recursive: true });
  const original = "# Repository test\nOriginal skill document.\n";
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

async function createProjectSkillCapability(
  root: string,
): Promise<{ capability: CapabilityPackageManifest; skill: SkillManifest }> {
  const path = resolve(root, ".lervo/capabilities/packages/repository%2Ftesting-cap@1.0.0");
  await mkdir(path, { recursive: true });
  const content = "# Capability skill\nUse the exact managed skill route.\n";
  await writeFile(resolve(path, "SKILL.md"), content);
  const contentHash = hashCapabilityFiles([
    { path: "SKILL.md", bytes: new TextEncoder().encode(content) },
  ]);
  const skill: SkillManifest = {
    schemaVersion: 1,
    skillId: "repository/capability-testing",
    version: "1.0.0",
    contentHash,
    source: {
      kind: "project",
      uri: ".lervo/capabilities",
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
  const capability: CapabilityPackageManifest = {
    schemaVersion: 1,
    capabilityId: "repository/testing-cap",
    kind: "skill",
    version: "1.0.0",
    contentHash,
    source: {
      kind: "project",
      uri: ".lervo/capabilities",
      publisher: { id: "local-fixture", name: "Local Fixture" },
    },
    compatibility: {
      providers: { mode: "allowlist", providers: ["codex"] },
      minimumRuntimeVersion: "0.1.0",
      platforms: [process.platform as "darwin" | "linux" | "win32"],
    },
    requiredPermissions: ["filesystem.read", "shell.execute"],
    dependencies: [],
    discovery: {
      displayName: "Repository test skill",
      summary: "Use the packaged repository testing workflow",
      keywords: ["repository", "testing"],
      intents: ["Use the packaged repository testing workflow"],
      autoSelect: true,
    },
    entrypoint: { kind: "skill", skillId: skill.skillId, manifestPath: "lervo-skill.json" },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  await writeFile(resolve(path, "lervo-skill.json"), `${JSON.stringify(skill)}\n`);
  await writeFile(resolve(path, "lervo-capability.json"), `${JSON.stringify(capability)}\n`);
  return { capability, skill };
}

async function createProjectMcpCapability(root: string): Promise<CapabilityPackageManifest> {
  const path = resolve(root, ".lervo/capabilities/packages/repository%2Fsearch-mcp@1.0.0");
  await mkdir(path, { recursive: true });
  const schema = new TextEncoder().encode("{}\n");
  const runtime = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      serverName: "repository-search",
      transport: {
        kind: "stdio",
        command: "node",
        entrypointPath: "server.mjs",
        arguments: [],
        timeoutMs: 5000,
      },
    }),
  );
  const server = new TextEncoder().encode("process.stdin.resume();\n");
  const files = [
    { path: "configuration.schema.json", bytes: schema },
    { path: "lervo-mcp.json", bytes: runtime },
    { path: "server.mjs", bytes: server },
  ];
  const capability: CapabilityPackageManifest = {
    schemaVersion: 1,
    capabilityId: "repository/search-mcp",
    kind: "mcp_server",
    version: "1.0.0",
    contentHash: hashCapabilityFiles(files),
    source: {
      kind: "project",
      uri: ".lervo/capabilities",
      publisher: { id: "local-fixture", name: "Local Fixture" },
    },
    compatibility: {
      providers: { mode: "allowlist", providers: ["codex"] },
      minimumRuntimeVersion: "0.1.0",
      platforms: [process.platform as "darwin" | "linux" | "win32"],
    },
    requiredPermissions: ["filesystem.read", "shell.execute"],
    dependencies: [],
    entrypoint: {
      kind: "mcp_server",
      adapterId: "mcp.stdio",
      configurationSchemaRef: "configuration.schema.json",
      runtimeDescriptorPath: "lervo-mcp.json",
      credentialNames: [],
    },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  for (const file of files) await writeFile(resolve(path, file.path), file.bytes);
  await writeFile(resolve(path, "lervo-capability.json"), `${JSON.stringify(capability)}\n`);
  return capability;
}

function identifierFactory(): (
  prefix: "run" | "ses" | "evt" | "ctx" | "envelope" | "turn",
) => string {
  let sequence = 0;
  return (prefix) => `${prefix}_cli${String(++sequence).padStart(8, "0")}`;
}

const passingSemanticEvaluator: WritingSemanticEvaluator = {
  async evaluate(request) {
    return {
      evaluator: { kind: "model", evaluatorId: "fixture.cli-korean-review.v1" },
      checks: request.checks.map((check) => ({
        checkId: check.checkId,
        status: "passed" as const,
        violationCount: 0,
      })),
    };
  },
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("lervo run vertical slice", () => {
  it("executes a repository-specialized role through the managed provider boundary", async () => {
    const root = await createRepository();
    await writeVerificationSuite(root, "process.exit(0)");
    await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
    await writeFile(
      resolve(root, ".lervo/roles/review-developer.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "lervo_repository_role",
          roleId: "review-developer",
          version: "1.0.0",
          extends: [],
          profile: {
            name: "Review Developer",
            description: "Runs a repository-defined implementation review contract.",
            requestTypes: ["implementation.review"],
            requiredInputs: [],
            contextPolicy: {
              requiredDocumentRuleIds: ["repository.instructions"],
              minimumAssurance: "E3",
              referencesRequired: true,
            },
            capabilities: {
              "filesystem.read": "allow",
              "filesystem.write": "allow",
              "shell.execute": "allow",
              "network.access": "deny",
              "external.message": "deny",
              deploy: "deny",
              "data.mutate": "deny",
            },
            defaultSkills: [],
            outputContract: {
              artifactKind: "review_result",
              schemaRef: "lervo-schema://roles/review-result/v1",
              pathTemplate: ".lervo/generated/review/{runId}.json",
              citationsRequired: false,
              presentation: { audience: "machine", writingPolicyId: null },
            },
            verification: { suiteIds: ["project.default"], failureDisposition: "fail_run" },
            handoff: {
              allowedRoleIds: ["developer"],
              evidenceLinksRequired: true,
              sharedContextRequired: true,
            },
          },
          checks: [
            {
              checkId: "review.project",
              category: "artifact_schema",
              method: "project_verification",
              requirement: "The repository review suite must pass.",
              verificationSuiteId: "project.default",
              evidenceRequired: true,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const client = new ManagedCodexClient(root);
    const executeManagedRun = createManagedRunExecutor({
      openStorage: openProjectStorage,
      createId: identifierFactory(),
      semanticEvaluator: passingSemanticEvaluator,
      createAdapter: ({ repositoryRoot, resolveArtifact }) =>
        new CodexAdapter({ repositoryRoot, resolveArtifact, clientFactory: async () => client }),
    });
    const outcome = await executeManagedRun({
      repositoryRoot: root,
      provider: "codex",
      roleId: "review-developer",
      expectedPath: "src/result.ts",
      instructions: "Review the implementation boundary",
      risk: "low",
      verificationSuiteIds: ["project.default"],
    });
    expect(outcome).toMatchObject({
      roleId: "review-developer",
      roleVersion: "1.0.0",
      roleContractHash: expect.stringMatching(/^sha256:/u),
      verificationStatus: "passed",
    });
  });

  it.each(["codex", "claude"] as const)(
    "runs one managed %s change through project storage and the production adapter",
    async (provider) => {
      const root = await createRepository();
      await registerLinkedSearchContextDocuments(root);
      const client =
        provider === "codex" ? new ManagedCodexClient(root) : new ManagedClaudeClient(root);
      let adapterCreations = 0;
      const executeManagedRun = createManagedRunExecutor({
        openStorage: openProjectStorage,
        createId: identifierFactory(),
        semanticEvaluator: passingSemanticEvaluator,
        createAdapter: ({ repositoryRoot, resolveArtifact }) => {
          adapterCreations += 1;
          return provider === "codex"
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
              });
        },
      });
      let output = "";
      let errorOutput = "";
      const exitCode = await runCli(
        [
          "run",
          "--provider",
          provider,
          "--path",
          "src/result.ts",
          "--verification",
          "project.default",
          "Implement a small file",
        ],
        {
          cwd: root,
          stdout: (message) => {
            output += message;
          },
          stderr: (message) => {
            errorOutput += message;
          },
        },
        { executeManagedRun },
      );

      expect(exitCode).toBe(0);
      expect(errorOutput).toBe("");
      expect(output).toContain("CLI task complete");
      expect(output).toContain("Functional verification: passed");
      expect(output).toContain("project.default: passed");
      expect(output).toContain("Writing publication verification: passed");
      expect(output).toMatch(/recommended \d+ · selected \d+/u);
      expect(adapterCreations).toBe(1);
      expect(output).not.toContain("linked-evidence-managed-canary");
      expect(output).toContain("Documents selected from search: doc_cli_search_context");
      expect(output).toContain("--selected document:doc_cli_search_context");
      expect(await readFile(resolve(root, "src/result.ts"), "utf8")).toBe(
        "export const cli = true;\n",
      );
      expect(client.closed).toBe(true);

      const storage = await openProjectStorage(root);
      const events = storage.events.list();
      await storage.close();
      expect(events.map((event) => event.type)).toContain("file.changed");
      expect(events.map((event) => event.type)).toContain("verification.started");
      expect(events.map((event) => event.type)).toContain("verification.completed");
      expect(events.map((event) => event.type)).toContain("run.completed");
      const recommendation = events.find((event) => event.type === "context.recommended");
      expect(recommendation?.payload).toMatchObject({
        documentId: "doc_cli_search_context",
        selectionPolicyId: "top_ranked",
      });
      expect(events.find((event) => event.type === "run.completed")?.payload).toMatchObject({
        verificationStatus: "passed",
      });
      expect(
        events.some(
          (event) =>
            (event.type === "context.selected" || event.type === "document.loaded") &&
            event.payload.documentId === "doc_zzz_linked_constraint",
        ),
      ).toBe(false);
      expect(
        events.find((event) => event.type === "context.injected")?.payload.documentIds,
      ).not.toContain("doc_zzz_linked_constraint");
      const knowledgeSources = await collectLocalKnowledgeSources(root);
      expect(knowledgeSources.filter((source) => source.kind === "verification_result")).toEqual([
        expect.objectContaining({
          path: expect.stringMatching(/^@verification\/ver_[a-f0-9]{16}$/),
          kind: "verification_result",
          origin: "verification_event_cas",
          unitKind: "verification",
        }),
      ]);
      expect(
        knowledgeSources.some(
          (source) =>
            source.kind === "execution_event" && source.origin === "execution_event_store",
        ),
      ).toBe(true);
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain("Implement a small file");
      expect(serialized).not.toContain("CLI task complete");
      expect(serialized).not.toContain("private fixture diff");
      expect(serialized).not.toContain("docs/search-context.md");
      const sourceAttemptId = recommendation?.payload.sourceAttemptId as string;
      const searchAttempt = await readFile(
        resolve(root, ".lervo/state/search/attempts", `${sourceAttemptId}.json`),
        "utf8",
      );
      expect(searchAttempt).not.toContain("Implement a small file");
      expect(searchAttempt).not.toContain("docs/search-context.md");
      await expect(
        access(resolve(root, ".lervo/state/search/assessments", `${sourceAttemptId}.json`)),
      ).rejects.toThrow();
    },
  );

  it("keeps the retired linked treatment available only through an explicit evaluation seam", async () => {
    const root = await createRepository();
    await registerLinkedSearchContextDocuments(root);
    const client = new ManagedCodexClient(root);
    const executeManagedRun = createManagedRunExecutor({
      openStorage: openProjectStorage,
      createId: identifierFactory(),
      semanticEvaluator: passingSemanticEvaluator,
      resolveExperimentalLinkedEvidenceSelection: resolveDefaultManagedLinkedEvidenceSelection,
      createAdapter: ({ repositoryRoot, resolveArtifact }) =>
        new CodexAdapter({
          repositoryRoot,
          resolveArtifact,
          clientFactory: async () => client,
        }),
    });

    const exitCode = await runCli(
      [
        "run",
        "--provider",
        "codex",
        "--path",
        "src/result.ts",
        "--verification",
        "project.default",
        "Implement a small file",
      ],
      { cwd: root, stdout: () => {}, stderr: () => {} },
      { executeManagedRun },
    );

    expect(exitCode).toBe(0);
    const storage = await openProjectStorage(root);
    const events = storage.events.list();
    await storage.close();
    expect(
      events.some(
        (event) =>
          (event.type === "context.selected" || event.type === "document.loaded") &&
          event.payload.documentId === "doc_zzz_linked_constraint",
      ),
    ).toBe(true);
  });

  it("keeps the completed change but hides provider prose when semantic review is unavailable", async () => {
    const root = await createRepository();
    const client = new ManagedCodexClient(root);
    const executeManagedRun = createManagedRunExecutor({
      openStorage: openProjectStorage,
      createId: identifierFactory(),
      now: () => new Date("2026-08-19T00:00:00Z"),
      groundProductionRequest: async ({ provider, availableCapabilityIds = [] }) => ({
        proposal: {
          schemaVersion: 1,
          requestDigest: `sha256:${"a".repeat(64)}`,
          resolver: {
            kind: "provider_adapter",
            providerId: provider,
            resultDigest: `sha256:${"b".repeat(64)}`,
          },
          intent: "change",
          subjectIds: ["managed.run"],
          references: [],
          protocolCoordinates: [],
          requestedEffectIds: ["managed.run"],
          prohibitedEffectIds: [],
          sourceClasses: ["repository_state"],
          retrievalQueries: [],
          workflowCandidateIds: ["managed.run"],
          capabilityCandidateIds: [...availableCapabilityIds],
          authorityRequirement: "repository_write",
          providerRoute: { mode: "current_provider_only", providerIds: [] },
          disposition: "execute",
          ambiguityReasons: [],
        },
        decision: {
          schemaVersion: 1,
          status: "ready",
          workflowId: "managed.run",
          effectIds: ["managed.run"],
          capabilityIds: [...availableCapabilityIds],
          providerIds: [provider],
          authority: "repository_write",
          sourceClasses: ["repository_state"],
          subjectIds: ["managed.run"],
          retrievalQueries: [],
          reasons: [],
        },
      }),
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
        "--verification",
        "project.default",
        "Implement a small file",
      ],
      {
        cwd: root,
        stdout: (message) => {
          output += message;
        },
        stderr: (message) => {
          errorOutput += message;
        },
      },
      { executeManagedRun },
    );

    expect(exitCode).toBe(1);
    expect(errorOutput).toBe("");
    expect(output).toContain("Writing publication verification: failed");
    expect(output).toContain("The provider result was not published.");
    expect(output).not.toContain("CLI task complete");
    expect(await readFile(resolve(root, "src/result.ts"), "utf8")).toBe(
      "export const cli = true;\n",
    );
    const storage = await openProjectStorage(root);
    expect(storage.events.list().map((event) => event.type)).toContain("run.completed");
    await storage.close();
  });

  it("locks, invokes, and records verified skill instructions without claiming semantic reliance", async () => {
    const root = await createRepository();
    const skill = await createProjectSkill(root);
    const userSkillRoot = await mkdtemp(resolve(tmpdir(), "lervo-user-skills-"));
    temporaryRoots.push(userSkillRoot);
    const client = new ManagedCodexClient(root);
    const executeManagedRun = createManagedRunExecutor({
      openStorage: openProjectStorage,
      createId: identifierFactory(),
      semanticEvaluator: passingSemanticEvaluator,
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
        "--verification",
        "project.default",
        "Interpret the skill and perform the task",
      ],
      {
        cwd: root,
        stdout: (message) => {
          output += message;
        },
        stderr: (message) => {
          errorOutput += message;
        },
      },
      { executeManagedRun },
    );

    expect(exitCode).toBe(0);
    expect(errorOutput).toBe("");
    expect(output).toContain("repository/testing@1.2.0 (project)");
    expect(output).toContain("Verified skill instructions were invoked by Lervo");
    expect(await readFile(resolve(skill.path, "SKILL.md"), "utf8")).toBe(skill.original);
    const lock: unknown = JSON.parse(await readFile(resolve(root, ".lervo/skills.lock"), "utf8"));
    expect(validateSchema("skillLock", lock).valid).toBe(true);
    expect(lock).toMatchObject({
      entries: [
        {
          skillId: "repository/testing",
          contentHash: skill.manifest.contentHash,
          source: { kind: "project", uri: ".agents/skills/repository-testing" },
        },
      ],
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
    expect(eventTypes).toContain("skill.invoked");
    expect(eventTypes).toContain("skill.completed");
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

  it("routes a resolved skill capability through the existing skill lock without claiming activation", async () => {
    const root = await createRepository();
    const value = await createProjectSkillCapability(root);
    const userSkillRoot = await mkdtemp(resolve(tmpdir(), "lervo-user-skills-"));
    temporaryRoots.push(userSkillRoot);
    const userCapabilityRoot = await mkdtemp(resolve(tmpdir(), "lervo-user-capabilities-"));
    temporaryRoots.push(userCapabilityRoot);
    const client = new ManagedCodexClient(root);
    const executeManagedRun = createManagedRunExecutor({
      openStorage: openProjectStorage,
      createId: identifierFactory(),
      semanticEvaluator: passingSemanticEvaluator,
      userSkillRoot,
      userCapabilityRoot,
      now: () => new Date("2026-08-19T00:00:00Z"),
      createAdapter: ({ repositoryRoot, resolveArtifact }) =>
        new CodexAdapter({ repositoryRoot, resolveArtifact, clientFactory: async () => client }),
    });
    const outcome = await executeManagedRun({
      repositoryRoot: root,
      provider: "codex",
      expectedPath: "src/result.ts",
      instructions: "Use the packaged skill",
      risk: "medium",
      capabilityIds: [value.capability.capabilityId],
      verificationSuiteIds: ["project.default"],
    });
    expect(outcome.resolvedCapabilities[0]).toMatchObject({
      capabilityId: value.capability.capabilityId,
      activationStatus: "resolved",
    });
    expect(outcome.resolvedSkills[0]).toMatchObject({
      skillId: value.skill.skillId,
      contentHash: value.skill.contentHash,
    });
    expect(
      validateSchema(
        "capabilityLock",
        JSON.parse(await readFile(resolve(root, ".lervo/capabilities.lock"), "utf8")),
      ).valid,
    ).toBe(true);
    expect(
      validateSchema(
        "skillLock",
        JSON.parse(await readFile(resolve(root, ".lervo/skills.lock"), "utf8")),
      ).valid,
    ).toBe(true);
  });

  it("selects a verified skill capability from natural-language intent and records every observable stage", async () => {
    const root = await createRepository();
    const value = await createProjectSkillCapability(root);
    const userCapabilityRoot = await mkdtemp(resolve(tmpdir(), "lervo-user-capabilities-"));
    temporaryRoots.push(userCapabilityRoot);
    const client = new ManagedCodexClient(root);
    const executeManagedRun = createManagedRunExecutor({
      openStorage: openProjectStorage,
      createId: identifierFactory(),
      semanticEvaluator: passingSemanticEvaluator,
      userCapabilityRoot,
      now: () => new Date("2026-08-19T00:00:00Z"),
      groundProductionRequest: async ({ provider, availableCapabilityIds = [] }) => ({
        proposal: {
          schemaVersion: 1,
          requestDigest: `sha256:${"a".repeat(64)}`,
          resolver: {
            kind: "provider_adapter",
            providerId: provider,
            resultDigest: `sha256:${"b".repeat(64)}`,
          },
          intent: "change",
          subjectIds: ["managed.run"],
          references: [],
          protocolCoordinates: [],
          requestedEffectIds: ["managed.run"],
          prohibitedEffectIds: [],
          sourceClasses: ["repository_state"],
          retrievalQueries: [],
          workflowCandidateIds: ["managed.run"],
          capabilityCandidateIds: [...availableCapabilityIds],
          authorityRequirement: "repository_write",
          providerRoute: { mode: "current_provider_only", providerIds: [] },
          disposition: "execute",
          ambiguityReasons: [],
        },
        decision: {
          schemaVersion: 1,
          status: "ready",
          workflowId: "managed.run",
          effectIds: ["managed.run"],
          capabilityIds: [...availableCapabilityIds],
          providerIds: [provider],
          authority: "repository_write",
          sourceClasses: ["repository_state"],
          subjectIds: ["managed.run"],
          retrievalQueries: [],
          reasons: [],
        },
      }),
      createAdapter: ({ repositoryRoot, resolveArtifact }) =>
        new CodexAdapter({ repositoryRoot, resolveArtifact, clientFactory: async () => client }),
    });
    const outcome = await executeManagedRun({
      repositoryRoot: root,
      provider: "codex",
      expectedPath: "src/result.ts",
      instructions: "Use the packaged repository testing workflow",
      risk: "medium",
      verificationSuiteIds: ["project.default"],
    });
    expect(outcome.resolvedCapabilities).toEqual([
      expect.objectContaining({ capabilityId: value.capability.capabilityId }),
    ]);
    const storage = await openProjectStorage(root);
    const events = storage.events.list();
    await storage.close();
    expect(events.find((event) => event.type === "capability.recommended")?.payload).toMatchObject({
      capabilityId: value.capability.capabilityId,
      reasonCodes: expect.arrayContaining(["intent_phrase"]),
    });
    expect(events.find((event) => event.type === "capability.selected")?.payload).toMatchObject({
      reason: "natural_language",
    });
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["capability.loaded", "skill.invoked", "skill.completed"]),
    );
  });

  it("activates a resolved MCP capability before the Codex managed turn", async () => {
    const root = await createRepository();
    const capability = await createProjectMcpCapability(root);
    const client = new ManagedCodexClient(root);
    const executeManagedRun = createManagedRunExecutor({
      openStorage: openProjectStorage,
      createId: identifierFactory(),
      semanticEvaluator: passingSemanticEvaluator,
      now: () => new Date("2026-08-19T00:00:00Z"),
      createAdapter: ({ repositoryRoot, resolveArtifact }) =>
        new CodexAdapter({ repositoryRoot, resolveArtifact, clientFactory: async () => client }),
    });
    const outcome = await executeManagedRun({
      repositoryRoot: root,
      provider: "codex",
      expectedPath: "src/result.ts",
      instructions: "Use the packaged MCP server",
      risk: "medium",
      capabilityIds: [capability.capabilityId],
      verificationSuiteIds: ["project.default"],
    });

    expect(outcome.activatedCapabilities).toEqual([
      expect.objectContaining({ capabilityId: capability.capabilityId, evidence: "mcp_connected" }),
    ]);
    expect(client.startOptions[0]).toMatchObject({
      config: { mcp_servers: { "repository-search": { command: "node" } } },
    });
    const storage = await openProjectStorage(root);
    expect(
      storage.events.list().filter((event) => event.type === "capability.activated"),
    ).toHaveLength(1);
    await storage.close();
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
        instructions: "failure fixture",
        risk: "medium",
        verificationSuiteIds: ["project.default"],
      }),
    ).rejects.toMatchObject({ code: "provider_start_failed" });
    expect(closeCount).toBe(1);
    expect(client.closed).toBe(true);
  });

  it("records failed verification evidence and does not emit run.completed", async () => {
    const root = await createRepository();
    await writeVerificationSuite(root, "process.exit(7)");
    const client = new ManagedCodexClient(root);
    const executeManagedRun = createManagedRunExecutor({
      openStorage: openProjectStorage,
      createId: identifierFactory(),
      semanticEvaluator: passingSemanticEvaluator,
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
        provider: "codex",
        expectedPath: "src/result.ts",
        instructions: "verification failure fixture",
        risk: "medium",
        verificationSuiteIds: ["project.default"],
      }),
    ).rejects.toMatchObject({
      code: "verification_failed",
      message: expect.stringContaining("project.default"),
    });

    const storage = await openProjectStorage(root);
    const events = storage.events.list();
    await storage.close();
    expect(events.map((event) => event.type)).toContain("verification.started");
    expect(events.find((event) => event.type === "verification.completed")?.payload).toMatchObject({
      status: "failed",
      nonPassedCommandIds: ["verify-result"],
    });
    expect(events.find((event) => event.type === "run.failed")?.payload).toMatchObject({
      failureCode: "verification_failed",
    });
    expect(events.map((event) => event.type)).not.toContain("run.completed");
    expect(JSON.stringify(events)).not.toContain("process.exit(7)");
  });
});
