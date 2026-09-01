import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  CodexAdapter,
  type CodexAppServerClient,
  type CodexThreadStartOptions,
} from "@lervo/adapter-codex";
import { createRemoteCommand } from "@lervo/remote-command-contract";
import type { ManagedCapabilityApprovalVerificationInput } from "@lervo/orchestrator";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { activateFixtureEventWriterV2 } from "../../project/test/fixture-event-writer.js";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { hashSkillPackage, readSkillLock } from "@lervo/skills";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRemoteDeveloperRole,
  ManagedProviderHostRoleRegistry,
  ManagedRemoteProviderHost,
} from "../src/index.js";

const roots: string[] = [];
const approvalId = `apr_${"a".repeat(64)}`;
const snapshotId = `pol_${"b".repeat(64)}`;

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
        this.wake = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  }
}

class ManagedCodexClient implements CodexAppServerClient {
  private readonly queue = new MessageQueue();
  private turnSequence = 0;
  private activeWrite: { path: string; turnId: string; itemId: string } | undefined;
  contextInjectionCount = 0;

  constructor(
    private readonly root: string,
    private readonly paths: readonly string[] = ["src/result.ts"],
  ) {
    this.queue.push({
      method: "thread/started",
      params: { thread: { id: "codex-host-session" } },
    });
  }

  async startThread(_options: CodexThreadStartOptions) {
    return { threadId: "codex-host-session" };
  }

  async injectItems() {
    this.contextInjectionCount += 1;
  }

  async startTurn(threadId: string) {
    const path = this.paths[this.turnSequence];
    if (path === undefined) throw new Error("fixture received an unexpected turn");
    this.turnSequence += 1;
    const turnId = `codex-host-turn-${this.turnSequence}`;
    const itemId = `codex-host-write-${this.turnSequence}`;
    this.activeWrite = { path, turnId, itemId };
    setImmediate(() =>
      this.queue.push(
        {
          method: "turn/started",
          params: { threadId, turn: { id: turnId } },
        },
        {
          method: "item/started",
          params: {
            threadId,
            turnId,
            item: {
              type: "fileChange",
              id: itemId,
              status: "inProgress",
              changes: [
                {
                  path: resolve(this.root, path),
                  kind: { type: "add" },
                  diff: "fixture diff",
                },
              ],
            },
          },
        },
        {
          id: "codex-host-approval",
          method: "item/fileChange/requestApproval",
          params: {
            threadId,
            turnId,
            itemId,
          },
        },
      ),
    );
    return { turnId };
  }

  async respondFileChangeApproval(_requestId: string | number, decision: "accept" | "decline") {
    if (decision !== "accept") return;
    const active = this.activeWrite;
    if (active === undefined) throw new Error("fixture has no active write");
    const content =
      active.path === "src/result.ts"
        ? "export const remote = true;\n"
        : "export const other = true;\n";
    await writeFile(resolve(this.root, active.path), content);
    this.queue.push(
      {
        method: "item/completed",
        params: {
          threadId: "codex-host-session",
          turnId: active.turnId,
          item: {
            type: "fileChange",
            id: active.itemId,
            status: "completed",
            changes: [
              {
                path: resolve(this.root, active.path),
                kind: { type: "add" },
                diff: "fixture diff",
              },
            ],
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "codex-host-session",
          turnId: active.turnId,
          item: {
            type: "agentMessage",
            id: `codex-host-result-${this.turnSequence}`,
            text: "Remote task complete",
          },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "codex-host-session",
          turn: { id: active.turnId, status: "completed", durationMs: 1 },
        },
      },
    );
    this.activeWrite = undefined;
  }

  async interruptTurn() {}
  async unsubscribe() {}
  notifications(signal: AbortSignal) {
    return this.queue.iterate(signal);
  }
  async close() {}
}

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-host-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_managed_host_01",
      now: new Date("2026-08-22T00:00:00.000Z"),
    }),
  );
  await activateFixtureEventWriterV2({
    repositoryRoot: root,
    projectId: "prj_managed_host_01",
    observedAt: "2026-08-22T00:00:00.000Z",
  });
  await mkdir(resolve(root, "src"));
  await mkdir(resolve(root, ".lervo/verifications"));
  await writeFile(resolve(root, "AGENTS.md"), "Change only the approved file.\n");
  await writeFile(
    resolve(root, ".lervo/verifications/repo.check.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: repo.check",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: verify-result",
      "    executable: node",
      "    arguments:",
      "      - -e",
      `      - ${JSON.stringify("process.exit(require('node:fs').existsSync('src/result.ts') ? 0 : 1)")}`,
      "    cwd: .",
      "    timeoutMs: 10000",
      "    maxOutputBytes: 4096",
      "    environmentVariableNames: []",
      "",
    ].join("\n"),
  );
  const storage = await openProjectStorage(root);
  const target = {
    projectId: storage.manifest.projectId,
    projectIdentityHash: calculateProjectIdentityHash(storage.manifest),
  };
  await storage.close();
  return { root, target };
}

async function projectSkill(root: string, projectId: string, roleId: string): Promise<void> {
  const platform =
    process.platform === "darwin" || process.platform === "linux" || process.platform === "win32"
      ? process.platform
      : "darwin";
  const directory = resolve(root, ".agents/skills/repository-testing");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "SKILL.md"), "# Repository testing\nTest procedure.\n");
  const contentHash = await hashSkillPackage(directory);
  await writeFile(
    resolve(directory, "lervo-skill.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      skillId: "repository/testing",
      version: "1.0.0",
      contentHash,
      source: {
        kind: "project",
        uri: "declared://repository-testing",
        publisher: { id: "fixture", name: "Fixture" },
      },
      supportedRoles: [roleId],
      compatibility: {
        providers: { mode: "any" },
        minimumRuntimeVersion: "0.1.0",
        platforms: [platform],
        requiredTools: [],
        unknownIsCompatible: false,
      },
      requiredCapabilities: ["filesystem.read"],
      contracts: {
        inputSchemaRef: "lervo-schema://skill/input/v1",
        outputSchemaRef: "lervo-schema://skill/output/v1",
      },
      trust: { level: "untrusted", signatureStatus: "unsigned" },
      enabledScope: { kind: "projects", projectIds: [projectId] },
      pinned: true,
    })}\n`,
  );
}

function ids() {
  let sequence = 0;
  return (prefix: "run" | "ses" | "evt" | "ctx" | "envelope" | "turn") =>
    `${prefix}_host${String(++sequence).padStart(8, "0")}`;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed remote provider host", () => {
  it("binds one signed approval path to the managed coordinator and project verification", async () => {
    const fixture = await repository();
    const request = "Implement the approved result file.";
    const bytes = new TextEncoder().encode(request);
    const command = createRemoteCommand({
      idempotencyKey: "idk_managed_provider_host_01",
      nonce: Buffer.alloc(32, 7).toString("base64url"),
      issuedAt: "2026-08-22T00:00:00.000Z",
      expiresAt: "2026-08-22T00:10:00.000Z",
      target: fixture.target,
      action: {
        kind: "managed_run",
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        request: {
          artifactId: "art_managed_provider_host_01",
          contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          byteCount: bytes.byteLength,
          mediaType: "text/plain; charset=utf-8",
        },
      },
    });
    const authorization = {
      schemaVersion: 1 as const,
      source: "remote_command" as const,
      command,
      commandSignerKeyId: "key_managed_provider_host_01",
      policySnapshotId: snapshotId,
      approvalIds: [approvalId],
    };
    const verify = vi.fn(async (_input: ManagedCapabilityApprovalVerificationInput) => ({
      approved: true as const,
      approvalId,
      policySnapshotId: snapshotId,
    }));
    const host = new ManagedRemoteProviderHost({
      repositoryRoot: fixture.root,
      target: fixture.target,
      providers: ["codex"],
      roles: ["developer"],
      roleRegistry: new ManagedProviderHostRoleRegistry(),
      approvalVerifier: { verify },
      createId: ids(),
      adapterFactory: {
        create: ({ repositoryRoot, resolveArtifact }) =>
          new CodexAdapter({
            repositoryRoot,
            resolveArtifact,
            clientFactory: async () => new ManagedCodexClient(repositoryRoot),
          }),
      },
    });

    await expect(
      host.execute({
        command,
        request,
        authorizedAt: "2026-08-22T00:01:00.000Z",
        policyAuthorization: authorization,
        approvedRepositoryPaths: ["src/result.ts"],
      }),
    ).resolves.toMatchObject({ runId: expect.stringMatching(/^run_host/) });

    expect(await readFile(resolve(fixture.root, "src/result.ts"), "utf8")).toBe(
      "export const remote = true;\n",
    );
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls.map(([input]) => input.requestedPath)).toEqual([
      null,
      "src/result.ts",
    ]);
    const storage = await openProjectStorage(fixture.root);
    const events = storage.events.list();
    await storage.close();
    expect(events.map((event) => event.type)).toContain("run.completed");
    expect(events.findIndex((event) => event.type === "work.causality.recorded")).toBeLessThan(
      events.findIndex((event) => event.type === "adapter.started"),
    );
    expect(events.find((event) => event.type === "run.completed")?.payload).toMatchObject({
      verificationStatus: "passed",
    });
    expect(events.find((event) => event.type === "capability.decided")?.payload).toMatchObject({
      approvalId,
    });
    expect(JSON.stringify(events)).not.toContain(request);
    expect(JSON.stringify(events)).not.toContain("Remote task complete");
  });

  it("runs a registered role and signed paths in one reinjected provider session", async () => {
    const fixture = await repository();
    await projectSkill(fixture.root, fixture.target.projectId, "maintainer");
    const request = "Change the two approved paths in order.";
    const bytes = new TextEncoder().encode(request);
    const command = createRemoteCommand({
      idempotencyKey: "idk_managed_provider_host_02",
      nonce: Buffer.alloc(32, 8).toString("base64url"),
      issuedAt: "2026-08-22T00:00:00.000Z",
      expiresAt: "2026-08-22T00:10:00.000Z",
      target: fixture.target,
      action: {
        kind: "managed_run",
        roleId: "maintainer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        request: {
          artifactId: "art_managed_provider_host_02",
          contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          byteCount: bytes.byteLength,
          mediaType: "text/plain; charset=utf-8",
        },
      },
    });
    const verify = vi.fn(async (_input: ManagedCapabilityApprovalVerificationInput) => ({
      approved: true as const,
      approvalId,
      policySnapshotId: snapshotId,
    }));
    const client = new ManagedCodexClient(fixture.root, ["src/other.ts", "src/result.ts"]);
    const roleRegistry = new ManagedProviderHostRoleRegistry([
      {
        ...createRemoteDeveloperRole(["repo.check"]),
        roleId: "maintainer",
        name: "Maintainer",
        defaultSkills: ["repository/testing"],
      },
    ]);
    const host = new ManagedRemoteProviderHost({
      repositoryRoot: fixture.root,
      target: fixture.target,
      providers: ["codex"],
      roles: ["maintainer"],
      roleRegistry,
      approvalVerifier: { verify },
      createId: ids(),
      adapterFactory: {
        create: ({ repositoryRoot, resolveArtifact }) =>
          new CodexAdapter({
            repositoryRoot,
            resolveArtifact,
            clientFactory: async () => client,
          }),
      },
    });

    await expect(
      host.execute({
        command,
        request,
        authorizedAt: "2026-08-22T00:01:00.000Z",
        policyAuthorization: {
          schemaVersion: 1,
          source: "remote_command",
          command,
          commandSignerKeyId: "key_managed_provider_host_01",
          policySnapshotId: snapshotId,
          approvalIds: [approvalId],
        },
        approvedRepositoryPaths: ["src/other.ts", "src/result.ts"],
      }),
    ).resolves.toMatchObject({ runId: expect.stringMatching(/^run_host/) });

    expect(await readFile(resolve(fixture.root, "src/other.ts"), "utf8")).toBe(
      "export const other = true;\n",
    );
    expect(await readFile(resolve(fixture.root, "src/result.ts"), "utf8")).toBe(
      "export const remote = true;\n",
    );
    expect(client.contextInjectionCount).toBe(2);
    expect(verify).toHaveBeenCalledTimes(3);
    expect(verify.mock.calls.map(([input]) => input.requestedPath)).toEqual([
      null,
      "src/other.ts",
      "src/result.ts",
    ]);
    const storage = await openProjectStorage(fixture.root);
    const events = storage.events.list();
    await storage.close();
    expect(
      events
        .filter((event) => event.type === "context.injected")
        .map((event) => event.payload.contextGeneration),
    ).toEqual([0, 1]);
    expect(events.filter((event) => event.type === "work.causality.recorded")).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "file.changed").map((event) => event.payload.path),
    ).toEqual(["src/other.ts", "src/result.ts"]);
    expect(events.find((event) => event.type === "skill.resolved")?.payload).toMatchObject({
      skillId: "repository/testing",
      version: "1.0.0",
      source: "project",
      trustStatus: "untrusted",
    });
    expect(events.find((event) => event.type === "run.completed")?.payload).toMatchObject({
      verificationStatus: "passed",
    });
    expect(JSON.stringify(events)).not.toContain("Test procedure.");
    await expect(readSkillLock(resolve(fixture.root, ".lervo/skills.lock"))).resolves.toMatchObject(
      { entries: [{ skillId: "repository/testing" }] },
    );
  });

  it("rejects duplicate approval paths before opening project storage", async () => {
    const fixture = await repository();
    const host = new ManagedRemoteProviderHost({
      repositoryRoot: fixture.root,
      target: fixture.target,
      providers: ["codex"],
      roles: ["developer"],
      roleRegistry: new ManagedProviderHostRoleRegistry(),
      approvalVerifier: { verify: async () => ({ approved: false, reasonCode: "unused" }) },
      openStorage: async () => {
        throw new Error("project storage must not open");
      },
      adapterFactory: {
        create: () => {
          throw new Error("provider must not start");
        },
      },
    });
    const request = "Reject duplicate path approvals.";
    const bytes = new TextEncoder().encode(request);
    const command = createRemoteCommand({
      idempotencyKey: "idk_managed_provider_host_03",
      nonce: Buffer.alloc(32, 9).toString("base64url"),
      issuedAt: "2026-08-22T00:00:00.000Z",
      expiresAt: "2026-08-22T00:10:00.000Z",
      target: fixture.target,
      action: {
        kind: "managed_run",
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        request: {
          artifactId: "art_managed_provider_host_03",
          contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          byteCount: bytes.byteLength,
          mediaType: "text/plain; charset=utf-8",
        },
      },
    });
    await expect(
      host.execute({
        command,
        request,
        authorizedAt: "2026-08-22T00:01:00.000Z",
        policyAuthorization: {
          schemaVersion: 1,
          source: "remote_command",
          command,
          commandSignerKeyId: "key_managed_provider_host_01",
          policySnapshotId: snapshotId,
          approvalIds: [approvalId],
        },
        approvedRepositoryPaths: ["src/result.ts", "src/result.ts"],
      }),
    ).rejects.toMatchObject({ code: "managed_approval_scope_invalid" });
  });
});
