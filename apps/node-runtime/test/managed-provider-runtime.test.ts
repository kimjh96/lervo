import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  ClaudeAdapter,
  type ClaudeAgentClient,
  type ClaudeAgentClientStartOptions,
  type ClaudeToolUseHandler,
} from "@lervo/adapter-claude";
import {
  CodexAdapter,
  type CodexAppServerClient,
  type CodexThreadStartOptions,
} from "@lervo/adapter-codex";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { Ed25519PolicySigner } from "@lervo/policy";
import {
  createPolicyApproval,
  createPolicyApprovalRevocation,
  createPolicySnapshot,
} from "@lervo/policy-contract";
import { loadProjectManifest } from "@lervo/project";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";
import {
  createRemoteCommand,
  createRemoteCommandDeliveryConfirmation,
  createRemoteCommandLease,
} from "@lervo/remote-command-contract";
import type { RemoteCommandDeliveryAcknowledgement } from "@lervo/schemas";
import { AuthenticatedHubHttpTransport, type SyncHttpTransportOptions } from "@lervo/sync";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createManagedProviderRemoteCommandPorts,
  openNodeRuntime,
  parseNodeRuntimeConfig,
  type NodeRuntimeDeployment,
} from "../src/index.js";
import {
  nodeRuntimeDestinationId,
  nodeRuntimeFixture,
  nodeRuntimeHubIdentityHash,
  ownerFile,
  removeTemporaryRoots,
  temporaryRoot,
  availablePort,
} from "./fixture.js";

const deployments: NodeRuntimeDeployment[] = [];
const claudeSessionId = "11111111-1111-4111-8111-111111111111";
const claudeTurnId = "22222222-2222-4222-8222-222222222222";

afterEach(async () => {
  await Promise.all(deployments.splice(0).map((deployment) => deployment.close()));
  await removeTemporaryRoots();
});

function localHttpTransport(options: SyncHttpTransportOptions): AuthenticatedHubHttpTransport {
  return new AuthenticatedHubHttpTransport({
    ...options,
    baseUrl: options.baseUrl.replace(/^https:/, "http:"),
    allowInsecureHttpForTests: true,
  });
}

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
        const value = this.values[index++];
        if (value instanceof Error) throw value;
        yield structuredClone(value);
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
  closed = false;

  constructor(
    private readonly repositoryRoot: string,
    private readonly failStream = false,
    private readonly paths: readonly string[] = ["src/result.ts"],
  ) {
    this.queue.push({
      method: "thread/started",
      params: { thread: { id: "codex-node-host-session" } },
    });
  }

  async startThread(_options: CodexThreadStartOptions) {
    return { threadId: "codex-node-host-session" };
  }

  async injectItems() {}

  async startTurn(threadId: string) {
    const path = this.paths[this.turnSequence];
    if (path === undefined) throw new Error("fixture received an unexpected turn");
    this.turnSequence += 1;
    const turnId = `codex-node-host-turn-${this.turnSequence}`;
    const itemId = `codex-node-host-write-${this.turnSequence}`;
    this.activeWrite = { path, turnId, itemId };
    if (this.failStream) {
      setImmediate(() =>
        this.queue.push(
          {
            method: "turn/started",
            params: { threadId, turn: { id: turnId } },
          },
          new Error("private provider stream failure"),
        ),
      );
      return { turnId };
    }
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
                  path: resolve(this.repositoryRoot, path),
                  kind: { type: "add" },
                  diff: "private provider diff",
                },
              ],
            },
          },
        },
        {
          id: "codex-node-host-approval",
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
    await writeFile(
      resolve(this.repositoryRoot, active.path),
      active.path === "src/result.ts"
        ? "export const remote = true;\n"
        : "export const other = true;\n",
    );
    this.queue.push(
      {
        method: "item/completed",
        params: {
          threadId: "codex-node-host-session",
          turnId: active.turnId,
          item: {
            type: "fileChange",
            id: active.itemId,
            status: "completed",
            changes: [
              {
                path: resolve(this.repositoryRoot, active.path),
                kind: { type: "add" },
                diff: "private provider diff",
              },
            ],
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId: "codex-node-host-session",
          turnId: active.turnId,
          item: {
            type: "agentMessage",
            id: `codex-node-host-result-${this.turnSequence}`,
            text: "private provider result",
          },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "codex-node-host-session",
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
  async close() {
    this.closed = true;
  }
}

class ManagedClaudeClient implements ClaudeAgentClient {
  private readonly queue = new MessageQueue();
  private handler: ClaudeToolUseHandler | undefined;
  private turnSequence = 0;

  constructor(
    private readonly repositoryRoot: string,
    private readonly paths: readonly string[] = ["src/result.ts"],
  ) {}

  attachToolUseHandler(handler: ClaudeToolUseHandler): void {
    this.handler = handler;
  }

  async appendContext() {
    this.queue.push({
      type: "system",
      subtype: "init",
      session_id: claudeSessionId,
      uuid: "33333333-3333-4333-8333-333333333333",
    });
  }

  async startTurn(turnId: string, instructions: string) {
    const path = this.paths[this.turnSequence];
    if (path === undefined) throw new Error("fixture received an unexpected turn");
    this.turnSequence += 1;
    const toolUseId = `claude-node-host-write-${this.turnSequence}`;
    const toolInput = {
      file_path: resolve(this.repositoryRoot, path),
      content:
        path === "src/result.ts" ? "export const remote = true;\n" : "export const other = true;\n",
    };
    const allowed = await this.handler?.authorize("Write", toolInput, toolUseId);
    if (allowed !== true) throw new Error("fixture write denied");
    await writeFile(toolInput.file_path, toolInput.content);
    await this.handler?.complete("Write", toolInput, toolUseId, "completed");
    this.queue.push(
      {
        type: "user",
        isReplay: true,
        shouldQuery: true,
        uuid: turnId,
        session_id: claudeSessionId,
        message: { role: "user", content: instructions },
        parent_tool_use_id: null,
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        user_message_uuid: turnId,
        uuid: `44444444-4444-4444-8444-${String(this.turnSequence).padStart(12, "0")}`,
        session_id: claudeSessionId,
        duration_ms: 1,
        result: "private provider result",
      },
    );
  }

  async interrupt() {}
  messages(signal: AbortSignal) {
    return this.queue.iterate(signal);
  }
  async close() {}
}

async function prepareManagedRepository(
  repositoryRoot: string,
  verificationScript = "process.exit(require('node:fs').existsSync('src/result.ts') ? 0 : 1)",
): Promise<void> {
  await mkdir(resolve(repositoryRoot, "src"));
  await mkdir(resolve(repositoryRoot, ".lervo/documents"));
  await mkdir(resolve(repositoryRoot, ".lervo/verifications"));
  await writeFile(resolve(repositoryRoot, "AGENTS.md"), "Change only the approved result file.\n");
  await writeFile(
    resolve(repositoryRoot, ".lervo/verifications/repo.check.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: repo.check",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: verify-result",
      "    executable: node",
      "    arguments:",
      "      - -e",
      `      - ${JSON.stringify(verificationScript)}`,
      "    cwd: .",
      "    timeoutMs: 10000",
      "    maxOutputBytes: 4096",
      "    environmentVariableNames: []",
      "",
    ].join("\n"),
  );
}

describe("built-in managed provider node runtime", () => {
  it.each([
    ["codex success", "codex", "success", ["src/result.ts"]],
    ["codex multi-file success", "codex", "success", ["src/other.ts", "src/result.ts"]],
    ["claude success", "claude", "success", ["src/result.ts"]],
    ["claude multi-file success", "claude", "success", ["src/other.ts", "src/result.ts"]],
    ["codex verification failure", "codex", "verification_failed", ["src/result.ts"]],
    ["codex provider start failure", "codex", "provider_start_failed", ["src/result.ts"]],
    ["codex provider stream failure", "codex", "provider_stream_failed", ["src/result.ts"]],
  ] as const)(
    "runs %s once across acknowledgement loss and restart",
    async (_scenario, expectedProvider, outcome, expectedPaths) => {
      const root = await temporaryRoot();
      const fixture = await nodeRuntimeFixture(root, await availablePort());
      await prepareManagedRepository(
        fixture.repositoryRoot,
        outcome === "verification_failed"
          ? "process.exit(7)"
          : expectedPaths.length > 1
            ? "const fs = require('node:fs'); process.exit(fs.existsSync('src/result.ts') && fs.existsSync('src/other.ts') ? 0 : 1)"
            : undefined,
      );
      const commandKeys = generateKeyPairSync("ed25519");
      const policyKeys = generateKeyPairSync("ed25519");
      const keyDirectory = resolve(root, "keys");
      await mkdir(keyDirectory, { mode: 0o700 });
      await ownerFile(
        resolve(keyDirectory, "command.pem"),
        String(
          commandKeys.publicKey.export({
            type: "spki",
            format: "pem",
          }),
        ),
      );
      await ownerFile(
        resolve(keyDirectory, "policy.pem"),
        String(
          policyKeys.publicKey.export({
            type: "spki",
            format: "pem",
          }),
        ),
      );
      const configured = structuredClone(fixture.value);
      configured.remoteCommands = {
        nodeId: "node_managed_host_01",
        commandKeys: [{ keyId: "key_command_host_01", publicKeyFile: "keys/command.pem" }],
        policyKeys: [
          {
            keyId: "key_policy_host_01",
            publicKeyFile: "keys/policy.pem",
            purposes: ["snapshot", "approval", "revocation"],
          },
        ],
        providerHost: {
          providers: [expectedProvider],
          roles: ["developer"],
          developerSkills: [],
        },
        idlePollIntervalMs: 100,
        retryDelayMs: 1_000,
        maxLifetimeMs: 15 * 60_000,
      };
      const config = parseNodeRuntimeConfig(configured, root);
      const manifest = await loadProjectManifest(fixture.repositoryRoot);
      const target = {
        projectId: manifest.projectId,
        projectIdentityHash: calculateProjectIdentityHash(manifest),
      };
      const request = "Implement the approved result file exactly once.";
      const requestBytes = new TextEncoder().encode(request);
      const base = Date.now();
      const issuedAt = new Date(base - 10_000).toISOString();
      const grantedAt = new Date(base - 5_000).toISOString();
      const evaluatedAt = new Date(base).toISOString();
      const expiresAt = new Date(base + 10 * 60_000).toISOString();
      const policyExpiresAt = new Date(base + 60 * 60_000).toISOString();
      const commandSigner = new Ed25519RemoteCommandSigner(
        "key_command_host_01",
        commandKeys.privateKey,
      );
      const command = createRemoteCommand({
        idempotencyKey: "idk_node_managed_host_01",
        nonce: Buffer.alloc(32, 5).toString("base64url"),
        issuedAt,
        expiresAt,
        target,
        action: {
          kind: "managed_run",
          roleId: "developer",
          provider: expectedProvider,
          risk: "medium",
          verificationSuiteIds: ["repo.check"],
          request: {
            artifactId: "art_node_managed_host_01",
            contentHash: `sha256:${createHash("sha256").update(requestBytes).digest("hex")}`,
            byteCount: requestBytes.byteLength,
            mediaType: "text/plain; charset=utf-8",
          },
        },
      });
      const envelope = commandSigner.sign(command);
      const snapshot = createPolicySnapshot({
        target,
        sequence: 1,
        previousSnapshotId: null,
        issuedAt,
        expiresAt: policyExpiresAt,
        rules: [
          {
            ruleId: "polr_node_managed_host_01",
            roleId: "developer",
            risk: "medium",
            capability: "filesystem.write",
            repositoryPaths: [...expectedPaths],
            decision: "require_approval",
          },
        ],
      });
      const approval = createPolicyApproval({
        snapshot,
        command,
        commandSignerKeyId: commandSigner.keyId,
        capability: "filesystem.write",
        repositoryPaths: [...expectedPaths],
        approverSubjectHash: `sha256:${createHash("sha256").update("fixture approver").digest("hex")}`,
        grantedAt,
        expiresAt,
      });
      const policySigner = new Ed25519PolicySigner("key_policy_host_01", policyKeys.privateKey);
      const bundle = {
        snapshot: policySigner.signSnapshot(snapshot),
        approvals: [policySigner.signApproval(approval)],
        revocations: [],
      };
      const clock = {
        value: evaluatedAt,
        now() {
          return this.value;
        },
      };
      let loseAcknowledgement = true;
      let lostAcknowledgement: RemoteCommandDeliveryAcknowledgement | undefined;
      let leaseSequence = 0;
      let providerStarts = 0;
      let codexClient: ManagedCodexClient | undefined;
      let claudeStartOptions: ClaudeAgentClientStartOptions | undefined;
      let claudeMessageSequence = 0;
      const builtInPorts = createManagedProviderRemoteCommandPorts(config, {
        createAdapter: ({ provider, repositoryRoot, resolveArtifact }) => {
          if (provider !== expectedProvider) return null;
          if (provider === "codex") {
            return new CodexAdapter({
              repositoryRoot,
              resolveArtifact,
              clientFactory: async () => {
                providerStarts += 1;
                if (outcome === "provider_start_failed") {
                  throw new Error("private provider start failure");
                }
                codexClient = new ManagedCodexClient(
                  repositoryRoot,
                  outcome === "provider_stream_failed",
                  expectedPaths,
                );
                return codexClient;
              },
            });
          }
          return new ClaudeAdapter({
            repositoryRoot,
            resolveArtifact,
            createProviderSessionId: () => claudeSessionId,
            createProviderMessageId: () => {
              claudeMessageSequence += 1;
              return claudeMessageSequence === 1
                ? claudeTurnId
                : `22222222-2222-4222-8222-${String(claudeMessageSequence).padStart(12, "0")}`;
            },
            clientFactory: async (options) => {
              providerStarts += 1;
              claudeStartOptions = {
                ...options,
                ...(options.tools === undefined ? {} : { tools: [...options.tools] }),
              };
              return new ManagedClaudeClient(repositoryRoot, expectedPaths);
            },
          });
        },
      });
      if (builtInPorts === undefined) throw new Error("expected built-in provider host ports");
      const remotePorts = () => ({
        ...builtInPorts,
        clock,
        createPolicyTransport: () => ({
          pullPolicyBundle: async (input: { destinationId: string }) => ({
            authentication: {
              status: "verified" as const,
              destinationId: input.destinationId,
              peerIdentityHash: nodeRuntimeHubIdentityHash,
            },
            body: bundle,
          }),
        }),
        createCommandTransport: () => ({
          pullRemoteCommands: async (input: { destinationId: string; nodeId: string }) => {
            leaseSequence += 1;
            const leasedAt = clock.value;
            return {
              authentication: {
                status: "verified" as const,
                destinationId: input.destinationId,
                peerIdentityHash: nodeRuntimeHubIdentityHash,
              },
              body: [
                createRemoteCommandLease({
                  destinationId: input.destinationId,
                  leaseId: `rcl_${Buffer.alloc(32, leaseSequence).toString("base64url")}`,
                  leasedTo: input.nodeId,
                  leasedAt,
                  leaseExpiresAt: new Date(Date.parse(leasedAt) + 30_000).toISOString(),
                  envelope,
                }),
              ],
            };
          },
          acknowledgeRemoteCommand: async (
            acknowledgement: RemoteCommandDeliveryAcknowledgement,
          ) => {
            if (loseAcknowledgement) {
              loseAcknowledgement = false;
              lostAcknowledgement = structuredClone(acknowledgement);
              throw new Error("fixture acknowledgement lost");
            }
            return {
              authentication: {
                status: "verified" as const,
                destinationId: nodeRuntimeDestinationId,
                peerIdentityHash: nodeRuntimeHubIdentityHash,
              },
              body: createRemoteCommandDeliveryConfirmation({
                acknowledgement,
                status: "accepted",
                confirmedAt: clock.value,
              }),
            };
          },
        }),
        createPayloadLoader: () => ({ load: async () => requestBytes }),
      });

      let first!: NodeRuntimeDeployment;
      first = await openNodeRuntime(config, {
        createTransport: localHttpTransport,
        remoteCommands: {
          ...remotePorts(),
          onCycle: () => {
            queueMicrotask(() => {
              void first.close();
            });
          },
        },
      });
      deployments.push(first);
      await first.start();
      await expect(first.closed).resolves.toMatchObject({
        status: "stopped",
        remoteControl: {
          lastCycle: { command: { status: "acknowledgement_pending" } },
        },
      });
      expect(providerStarts).toBe(1);
      expect(lostAcknowledgement).toMatchObject({
        disposition: "completed",
        receipt:
          outcome === "success"
            ? { outcome: "executed" }
            : { outcome: "failed", failureCode: "execution_failed" },
      });
      if (expectedProvider === "claude") {
        expect(claudeStartOptions).toMatchObject({
          permissionMode: "default",
          tools: ["Read", "Glob", "Grep", "Write", "Edit"],
        });
      }
      if (outcome === "provider_start_failed" || outcome === "provider_stream_failed") {
        for (const path of expectedPaths) {
          await expect(
            readFile(resolve(fixture.repositoryRoot, path), "utf8"),
          ).rejects.toMatchObject({ code: "ENOENT" });
        }
      } else {
        expect(await readFile(resolve(fixture.repositoryRoot, "src/result.ts"), "utf8")).toBe(
          "export const remote = true;\n",
        );
        if (expectedPaths.length > 1) {
          expect(await readFile(resolve(fixture.repositoryRoot, "src/other.ts"), "utf8")).toBe(
            "export const other = true;\n",
          );
        }
      }

      const eventStore = await SQLiteEventStore.open({
        path: fixture.databasePath,
        projectId: manifest.projectId,
      });
      const events = eventStore.list();
      eventStore.close();
      const eventTypes = events.map((event) => event.type);
      if (outcome === "provider_start_failed" || outcome === "provider_stream_failed") {
        expect(events.find((event) => event.type === "run.failed")?.payload).toMatchObject({
          failureCode: outcome,
        });
        expect(eventTypes).not.toContain("verification.started");
        expect(eventTypes).not.toContain("verification.completed");
        expect(eventTypes).not.toContain("run.completed");
      } else if (outcome === "verification_failed") {
        expect(eventTypes).toContain("verification.completed");
        expect(
          events.find((event) => event.type === "verification.completed")?.payload,
        ).toMatchObject({ status: "failed", nonPassedCommandIds: ["verify-result"] });
        expect(events.find((event) => event.type === "run.failed")?.payload).toMatchObject({
          failureCode: "verification_failed",
        });
        expect(eventTypes).not.toContain("run.completed");
      } else {
        expect(eventTypes).toContain("verification.completed");
        expect(events.find((event) => event.type === "run.completed")?.payload).toMatchObject({
          verificationStatus: "passed",
        });
        expect(events.filter((event) => event.type === "file.changed")).toHaveLength(
          expectedPaths.length,
        );
        expect(events.filter((event) => event.type === "context.injected")).toHaveLength(
          expectedPaths.length,
        );
      }
      if (outcome === "provider_start_failed" || outcome === "provider_stream_failed") {
        expect(eventTypes).not.toContain("capability.decided");
      } else {
        expect(events.find((event) => event.type === "capability.decided")?.payload).toMatchObject({
          approvalId: approval.approvalId,
        });
      }
      const persistedEvents = JSON.stringify(events);
      expect(persistedEvents).not.toContain(request);
      expect(persistedEvents).not.toContain("private provider result");
      expect(persistedEvents).not.toContain("private provider diff");
      expect(persistedEvents).not.toContain("process.exit(7)");
      expect(persistedEvents).not.toContain("private provider start failure");
      expect(persistedEvents).not.toContain("private provider stream failure");
      for (const databaseName of ["policy.sqlite", "remote-command-replay.sqlite"]) {
        const database = await readFile(
          resolve(fixture.repositoryRoot, ".lervo/data", databaseName),
        );
        expect(database.toString("utf8")).not.toContain(request);
        expect(database.toString("utf8")).not.toContain("private provider result");
      }

      clock.value = new Date(Date.parse(clock.value) + 31_000).toISOString();
      let second!: NodeRuntimeDeployment;
      second = await openNodeRuntime(config, {
        createTransport: localHttpTransport,
        remoteCommands: {
          ...remotePorts(),
          onCycle: () => {
            queueMicrotask(() => {
              void second.close();
            });
          },
        },
      });
      deployments.push(second);
      await second.start();
      await expect(second.closed).resolves.toMatchObject({
        status: "stopped",
        remoteControl: {
          lastCycle: {
            policy: { status: "duplicate" },
            command: { status: "processed", duplicateCount: 1, executedCount: 0 },
          },
        },
      });
      expect(providerStarts).toBe(1);
      if (codexClient !== undefined) expect(codexClient.closed).toBe(true);
    },
  );

  it.each([
    ["expired", "approval_required"],
    ["revoked", "approval_required"],
  ] as const)("does not start a provider for %s approval scope", async (scenario, failureCode) => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    await prepareManagedRepository(fixture.repositoryRoot);
    const commandKeys = generateKeyPairSync("ed25519");
    const policyKeys = generateKeyPairSync("ed25519");
    const keyDirectory = resolve(root, "keys");
    await mkdir(keyDirectory, { mode: 0o700 });
    await ownerFile(
      resolve(keyDirectory, "command.pem"),
      String(
        commandKeys.publicKey.export({
          type: "spki",
          format: "pem",
        }),
      ),
    );
    await ownerFile(
      resolve(keyDirectory, "policy.pem"),
      String(
        policyKeys.publicKey.export({
          type: "spki",
          format: "pem",
        }),
      ),
    );
    const configured = structuredClone(fixture.value);
    configured.remoteCommands = {
      nodeId: "node_rejected_host_01",
      commandKeys: [{ keyId: "key_command_reject_01", publicKeyFile: "keys/command.pem" }],
      policyKeys: [
        {
          keyId: "key_policy_reject_01",
          publicKeyFile: "keys/policy.pem",
          purposes: ["snapshot", "approval", "revocation"],
        },
      ],
      providerHost: { providers: ["codex"], roles: ["developer"], developerSkills: [] },
      idlePollIntervalMs: 100,
      retryDelayMs: 1_000,
      maxLifetimeMs: 15 * 60_000,
    };
    const config = parseNodeRuntimeConfig(configured, root);
    const manifest = await loadProjectManifest(fixture.repositoryRoot);
    const target = {
      projectId: manifest.projectId,
      projectIdentityHash: calculateProjectIdentityHash(manifest),
    };
    const request = `This ${scenario} approval must be rejected.`;
    const requestBytes = new TextEncoder().encode(request);
    const base = Date.now();
    const issuedAt = new Date(base - 20_000).toISOString();
    const grantedAt = new Date(base - 15_000).toISOString();
    const evaluatedAt = new Date(base).toISOString();
    const commandExpiresAt = new Date(base + 10 * 60_000).toISOString();
    const approvalExpiresAt =
      scenario === "expired" ? new Date(base - 5_000).toISOString() : commandExpiresAt;
    const repositoryPaths = ["src/result.ts"];
    const commandSigner = new Ed25519RemoteCommandSigner(
      "key_command_reject_01",
      commandKeys.privateKey,
    );
    const command = createRemoteCommand({
      idempotencyKey: `idk_node_rejected_${scenario}_01`,
      nonce: Buffer.alloc(32, scenario === "expired" ? 6 : scenario === "revoked" ? 7 : 8).toString(
        "base64url",
      ),
      issuedAt,
      expiresAt: commandExpiresAt,
      target,
      action: {
        kind: "managed_run",
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        request: {
          artifactId: `art_node_rejected_${scenario}_01`,
          contentHash: `sha256:${createHash("sha256").update(requestBytes).digest("hex")}`,
          byteCount: requestBytes.byteLength,
          mediaType: "text/plain; charset=utf-8",
        },
      },
    });
    const snapshot = createPolicySnapshot({
      target,
      sequence: 1,
      previousSnapshotId: null,
      issuedAt,
      expiresAt: new Date(base + 60 * 60_000).toISOString(),
      rules: [
        {
          ruleId: `polr_node_rejected_${scenario}_01`,
          roleId: "developer",
          risk: "medium",
          capability: "filesystem.write",
          repositoryPaths,
          decision: "require_approval",
        },
      ],
    });
    const approval = createPolicyApproval({
      snapshot,
      command,
      commandSignerKeyId: commandSigner.keyId,
      capability: "filesystem.write",
      repositoryPaths,
      approverSubjectHash: `sha256:${createHash("sha256").update("rejected fixture approver").digest("hex")}`,
      grantedAt,
      expiresAt: approvalExpiresAt,
    });
    const policySigner = new Ed25519PolicySigner("key_policy_reject_01", policyKeys.privateKey);
    const revocations =
      scenario === "revoked"
        ? [
            policySigner.signRevocation(
              createPolicyApprovalRevocation({
                approval,
                revokedAt: new Date(base - 5_000).toISOString(),
                reasonCode: "cancelled",
              }),
            ),
          ]
        : [];
    const bundle = {
      snapshot: policySigner.signSnapshot(snapshot),
      approvals: [policySigner.signApproval(approval)],
      revocations,
    };
    const envelope = commandSigner.sign(command);
    const clock = {
      value: evaluatedAt,
      now() {
        return this.value;
      },
    };
    let adapterCreations = 0;
    const builtInPorts = createManagedProviderRemoteCommandPorts(config, {
      createAdapter: () => {
        adapterCreations += 1;
        throw new Error("rejected command must not create a provider adapter");
      },
    });
    if (builtInPorts === undefined) throw new Error("expected built-in provider host ports");
    const acknowledge = vi.fn(async (acknowledgement: RemoteCommandDeliveryAcknowledgement) => ({
      authentication: {
        status: "verified" as const,
        destinationId: nodeRuntimeDestinationId,
        peerIdentityHash: nodeRuntimeHubIdentityHash,
      },
      body: createRemoteCommandDeliveryConfirmation({
        acknowledgement,
        status: "accepted",
        confirmedAt: clock.value,
      }),
    }));
    let deployment!: NodeRuntimeDeployment;
    deployment = await openNodeRuntime(config, {
      createTransport: localHttpTransport,
      remoteCommands: {
        ...builtInPorts,
        clock,
        createPolicyTransport: () => ({
          pullPolicyBundle: async (input: { destinationId: string }) => ({
            authentication: {
              status: "verified" as const,
              destinationId: input.destinationId,
              peerIdentityHash: nodeRuntimeHubIdentityHash,
            },
            body: bundle,
          }),
        }),
        createCommandTransport: () => ({
          pullRemoteCommands: async (input: { destinationId: string; nodeId: string }) => ({
            authentication: {
              status: "verified" as const,
              destinationId: input.destinationId,
              peerIdentityHash: nodeRuntimeHubIdentityHash,
            },
            body: [
              createRemoteCommandLease({
                destinationId: input.destinationId,
                leaseId: `rcl_${Buffer.alloc(32, 9).toString("base64url")}`,
                leasedTo: input.nodeId,
                leasedAt: clock.value,
                leaseExpiresAt: new Date(Date.parse(clock.value) + 30_000).toISOString(),
                envelope,
              }),
            ],
          }),
          acknowledgeRemoteCommand: acknowledge,
        }),
        createPayloadLoader: () => ({ load: async () => requestBytes }),
        onCycle: () => {
          queueMicrotask(() => {
            void deployment.close();
          });
        },
      },
    });
    deployments.push(deployment);
    await deployment.start();

    if (failureCode === "approval_required") {
      await expect(deployment.closed).resolves.toMatchObject({
        status: "stopped",
        remoteControl: {
          lastCycle: {
            command: { status: "local_deferred", failureCode: "approval_required" },
          },
        },
      });
      expect(acknowledge).not.toHaveBeenCalled();
    } else {
      await expect(deployment.closed).resolves.toMatchObject({
        status: "stopped",
        remoteControl: {
          lastCycle: {
            command: { status: "processed", executedCount: 0, failedCount: 1 },
          },
        },
      });
      expect(acknowledge).toHaveBeenCalledTimes(1);
    }
    expect(adapterCreations).toBe(0);
    await expect(
      readFile(resolve(fixture.repositoryRoot, "src/result.ts"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
