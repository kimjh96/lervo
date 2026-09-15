import { EventEmitter } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runLocalSupervisionCli } from "../src/local-supervision-cli.js";
import { parseLocalSupervisionConfig } from "../src/local-supervision-config.js";
import type { openNodeSupervisionService } from "../src/supervision-startup.js";
import { readLocalSupervisionRequest } from "../src/local-supervision-request.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-local-supervision-"));
  roots.push(root);
  const config = {
    schemaVersion: 1,
    repositoryRoot: "repository",
    outcomeSupervision: {
      binding: {
        supervisionId: "supervision.local",
        workstreamId: `wks_${"a".repeat(24)}`,
        ownerAgentId: `agt_${"b".repeat(24)}`,
        mandateHash: `sha256:${"c".repeat(64)}`,
      },
      runtimeReadiness: {
        providerExecutables: { codex: process.execPath },
        providerLoginContexts: { codex: { homeDirectory: root, configurationDirectory: root } },
        verificationTools: {},
        workerWorkspace: {
          parentDirectory: resolve(root, "workers"),
          baseCommit: "a".repeat(40),
          integrationTargetDigest: `sha256:${"b".repeat(64)}`,
        },
      },
      ownerReasoning: { provider: "codex", reservedTokens: 100 },
      managedExecution: { nodeExecutable: process.execPath, cliBundle: resolve(root, "cli.js") },
    },
  };
  const path = resolve(root, "local.json");
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  const signals = new EventEmitter();
  const stdout = vi.fn(),
    stderr = vi.fn();
  const start = vi.fn(),
    close = vi.fn(async (): Promise<void> => undefined);
  let fail!: () => void;
  const failed = new Promise<void>((resolve) => {
    fail = resolve;
  });
  const binding = {
    supervisionId: "supervision.fixture",
    workstreamId: `wks_${"b".repeat(24)}`,
    ownerAgentId: `agt_${"c".repeat(24)}`,
    mandateHash: `sha256:${"d".repeat(64)}`,
  };
  const openService = vi.fn<typeof openNodeSupervisionService>(async () => ({
    start,
    close,
    failed,
    rebind: async () => undefined,
    currentBinding: () => binding,
  }));
  return {
    root,
    path,
    config,
    signals,
    stdout,
    stderr,
    start,
    close,
    fail,
    openService,
    ports: { cwd: root, signals, stdout, stderr, openService },
  };
}

it("checks owner-only local configuration without a Hub, authority observation or provider startup", async () => {
  const f = await fixture();
  expect(await runLocalSupervisionCli(["--check-config", f.path], f.ports)).toBe(0);
  expect(f.openService).not.toHaveBeenCalled();
  expect(f.stdout.mock.calls.flat().join("")).toContain("authority is unchecked");
  const parsed = parseLocalSupervisionConfig(f.config, f.root);
  expect(parsed.repositoryRoot).toBe(resolve(f.root, "repository"));
  f.config.outcomeSupervision.binding.ownerAgentId = `agt_${"d".repeat(24)}`;
  expect(parsed.configuration.binding.ownerAgentId).not.toBe(
    f.config.outcomeSupervision.binding.ownerAgentId,
  );
  expect(() => parseLocalSupervisionConfig({ ...f.config, hub: {} }, f.root)).toThrow();
  expect(() => parseLocalSupervisionConfig({ ...f.config, schemaVersion: 2 }, f.root)).toThrow();
});

it("admits stdin through the shared owner path before starting the local service", async () => {
  const f = await fixture();
  const admitRequest = vi.fn(async () => ({ eventId: `evt_${"a".repeat(32)}`, duplicate: false }));
  const running = runLocalSupervisionCli(["--config", f.path, "--request-stdin"], {
    ...f.ports,
    stdin: (async function* () {
      yield Buffer.from("Bounded local goal.");
    })(),
    admitRequest,
  });
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  expect(admitRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      repositoryRoot: resolve(f.root, "repository"),
      binding: f.config.outcomeSupervision.binding,
      request: expect.objectContaining({ source: "local", request: "Bounded local goal." }),
    }),
  );
  expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({
    component: "supervision_intake",
    eventId: `evt_${"a".repeat(32)}`,
  });
  f.signals.emit("SIGTERM");
  expect(await running).toBe(0);
});

it("rejects empty or oversized local stdin before any owner or provider startup", async () => {
  const f = await fixture();
  await expect(
    readLocalSupervisionRequest(
      (async function* () {
        yield " ";
      })(),
    ),
  ).rejects.toThrow();
  await expect(
    readLocalSupervisionRequest(
      (async function* () {
        yield "x".repeat(16_385);
      })(),
    ),
  ).rejects.toThrow();
  const admitRequest = vi.fn();
  expect(
    await runLocalSupervisionCli(["--config", f.path, "--request-stdin"], {
      ...f.ports,
      stdin: (async function* () {
        yield " ";
      })(),
      admitRequest,
    }),
  ).toBe(1);
  expect(admitRequest).not.toHaveBeenCalled();
  expect(f.openService).not.toHaveBeenCalled();
});

it("rejects unsafe files, unknown options and transport origins before opening a service", async () => {
  const f = await fixture();
  await chmod(f.path, 0o644);
  expect(await runLocalSupervisionCli(["--config", f.path], f.ports)).toBe(1);
  expect(await runLocalSupervisionCli(["--config", f.path, "--approve"], f.ports)).toBe(1);
  expect(f.openService).not.toHaveBeenCalled();
  expect(f.stderr.mock.calls.flat().join("")).not.toContain(f.root);
  expect(() =>
    parseLocalSupervisionConfig(
      {
        ...f.config,
        outcomeSupervision: {
          ...f.config.outcomeSupervision,
          resultOrigin: {
            sourceEventId: `cve_${"3".repeat(64)}`,
            policyId: `cpp_${"4".repeat(64)}`,
            target: {
              integrationId: "itg_localtest",
              projectId: `prj_${"a".repeat(16)}`,
              conversationId: "cnv_localtest",
              threadId: null,
            },
            actor: { kind: "agent", participantId: "ptc_localtest", roleId: "developer" },
          },
        },
      },
      f.root,
    ),
  ).toThrow(/separate configured transport/u);
});

it("reports actual service health and drains shutdown once across duplicate signals", async () => {
  const f = await fixture();
  const running = runLocalSupervisionCli(["--config", f.path], f.ports);
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  await f.openService.mock.calls[0]![0].observeHealth({ status: "ready" });
  expect(JSON.parse(f.stdout.mock.calls[0]![0])).toEqual({
    schemaVersion: 1,
    component: "supervision",
    status: "ready",
  });
  let finishClose!: () => void;
  f.close.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishClose = resolve;
      }),
  );
  f.signals.emit("SIGTERM");
  f.signals.emit("SIGINT");
  await vi.waitFor(() => expect(f.close).toHaveBeenCalledOnce());
  expect(f.signals.emit("SIGTERM")).toBe(true);
  expect(f.signals.emit("SIGINT")).toBe(true);
  expect(f.close).toHaveBeenCalledOnce();
  let settled = false;
  void running.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  finishClose();
  expect(await running).toBe(0);
  expect(f.signals.listenerCount("SIGTERM")).toBe(0);
  expect(f.signals.listenerCount("SIGINT")).toBe(0);
});

it("closes a service opened after a stop request without starting its owner loop", async () => {
  const f = await fixture();
  const service = {
    start: f.start,
    close: f.close,
    failed: new Promise<void>(() => undefined),
    rebind: async () => undefined,
    currentBinding: () => ({
      supervisionId: "supervision.fixture",
      workstreamId: `wks_${"b".repeat(24)}`,
      ownerAgentId: `agt_${"c".repeat(24)}`,
      mandateHash: `sha256:${"d".repeat(64)}`,
    }),
  };
  let opened!: (value: typeof service) => void;
  f.openService.mockImplementation(
    () =>
      new Promise((resolve) => {
        opened = resolve;
      }),
  );
  const running = runLocalSupervisionCli(["--config", f.path], f.ports);
  await vi.waitFor(() => expect(f.openService).toHaveBeenCalledOnce());
  f.signals.emit("SIGTERM");
  opened(service);
  expect(await running).toBe(0);
  expect(f.start).not.toHaveBeenCalled();
  expect(f.close).toHaveBeenCalledOnce();
});

it("returns failure and releases signal handlers after service or startup failure", async () => {
  const f = await fixture();
  const running = runLocalSupervisionCli(["--config", f.path], f.ports);
  await vi.waitFor(() => expect(f.start).toHaveBeenCalledOnce());
  f.fail();
  expect(await running).toBe(1);
  expect(f.close).toHaveBeenCalledOnce();
  expect(f.stderr.mock.calls.flat().join("")).toContain("supervision_runtime_failed");
  f.openService.mockRejectedValue(new Error("private credential details"));
  expect(await runLocalSupervisionCli(["--config", f.path], f.ports)).toBe(1);
  expect(f.stderr.mock.calls.flat().join("")).not.toContain("private credential");
  expect(f.signals.listenerCount("SIGTERM")).toBe(0);
});
