import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SQLiteNodeWorkAdmission,
  nodeWorkAdmissionDatabasePath,
  nodeWorkAdmissionScope,
} from "../../../packages/node-work-admission/src/index.js";
import { manageRuntimeService } from "../manage-runtime-service.mjs";
import { renderRuntimeService, runtimeServiceStopTimeoutMs } from "../render-runtime-service.mjs";

const roots = [];
const nodeInstance = "nfi_0123456789abcdef01234567";

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture(manager, runtime = "hub") {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-service-manage-"));
  roots.push(root);
  const executable = resolve(root, "lervo-runtime");
  const config = resolve(root, "runtime.json");
  const definition = resolve(root, manager === "systemd" ? "runtime.service" : "runtime.plist");
  await writeFile(executable, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  await writeFile(config, JSON.stringify(runtime === "node" ? { repositoryRoot: root } : {}), {
    mode: 0o600,
  });
  await renderRuntimeService([
    "--manager",
    manager,
    "--runtime",
    runtime,
    ...(runtime === "node" ? ["--instance", nodeInstance] : []),
    "--executable",
    executable,
    "--config",
    config,
    "--output",
    definition,
  ]);
  const writeArgs = (action) => [
    "--action",
    action,
    "--manager",
    manager,
    "--runtime",
    runtime,
    ...(runtime === "node" ? ["--instance", nodeInstance] : []),
    "--definition",
    definition,
    "--executable",
    executable,
    "--config",
    config,
    "--write",
  ];
  return { root, executable, config, definition, writeArgs };
}

function openIdleNodeAdmission() {
  return {
    scope: `sha256:${"a".repeat(64)}`,
    store: {
      tryFreeze: ({ scope }) => ({
        status: "frozen",
        freeze: { token: "fixture-freeze", scope, ownerPid: process.pid },
      }),
      unfreeze: () => true,
      close: () => undefined,
    },
  };
}

it("does not stop an active supervised Node when its owner lease is busy", async () => {
  const value = await fixture("systemd", "node");
  await writeFile(
    value.config,
    JSON.stringify({
      repositoryRoot: "repository",
      outcomeSupervision: {
        standing: {
          supervisionId: "supervision.test",
          ownerAgentId: `agt_${"a".repeat(24)}`,
          workstreamId: `wks_${"b".repeat(24)}`,
          mandateHash: `sha256:${"c".repeat(64)}`,
        },
      },
    }),
  );
  const commands = [];
  await expect(
    manageRuntimeService(
      [
        ...value.writeArgs("upgrade").filter((item) => item !== "--write"),
        "--previous-definition",
        value.definition,
        "--write",
      ],
      {
        platform: "linux",
        homeDirectory: value.root,
        runCommand: async (...args) => {
          commands.push(args);
          return { exitCode: 0 };
        },
        openSupervisionLeases: async () => ({
          acquire: () => null,
          close: () => undefined,
        }),
        resolveStandingSupervision: async (_root, binding) => ({
          binding: { ...binding, supervisionId: "supervision.test.s1" },
          index: 1,
          nextSupervisionId: "supervision.test.s2",
        }),
      },
    ),
  ).rejects.toMatchObject({ code: "service_upgrade_supervision_busy" });
  expect(commands).toEqual([]);
});

it("refuses a busy Node before stop and holds the idle freeze through manager replacement", async () => {
  const previous = await fixture("systemd", "node");
  const replacementExecutable = resolve(previous.root, "lervo-runtime-v2");
  const replacementDefinition = resolve(previous.root, "runtime-v2.service");
  await writeFile(replacementExecutable, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(replacementExecutable, 0o700);
  await renderRuntimeService([
    "--manager",
    "systemd",
    "--runtime",
    "node",
    "--instance",
    nodeInstance,
    "--executable",
    replacementExecutable,
    "--config",
    previous.config,
    "--output",
    replacementDefinition,
  ]);
  const source = await readFile(previous.config, "utf8");
  const configDigest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  const scope = nodeWorkAdmissionScope(previous.config);
  const admission = await SQLiteNodeWorkAdmission.open({
    path: nodeWorkAdmissionDatabasePath(previous.root),
  });
  const session = admission.registerSession({ scope, configDigest });
  const manager = systemdManager();
  let frozenDuringStop = false;
  const options = {
    platform: "linux",
    homeDirectory: previous.root,
    runCommand: async (command, args) => {
      if (command === "systemctl" && args[1] === "stop") {
        frozenDuringStop = admission.tryAcquireWork(session) === null;
      }
      return manager.run(command, args);
    },
    wait: async () => {},
  };
  const upgradeArgs = [
    "--action",
    "upgrade",
    "--manager",
    "systemd",
    "--runtime",
    "node",
    "--instance",
    nodeInstance,
    "--definition",
    replacementDefinition,
    "--previous-definition",
    previous.definition,
    "--executable",
    replacementExecutable,
    "--config",
    previous.config,
    "--write",
  ];
  try {
    await manageRuntimeService(previous.writeArgs("install"), options);
    const claim = admission.tryAcquireWork(session);
    if (claim === null) throw new Error("The test Node did not admit work.");
    const callsBeforeBusy = manager.calls.length;
    await expect(manageRuntimeService(upgradeArgs, options)).rejects.toMatchObject({
      code: "service_upgrade_work_busy",
    });
    expect(manager.calls.length).toBe(callsBeforeBusy);
    admission.releaseWork(claim);
    await expect(manageRuntimeService(upgradeArgs, options)).resolves.toMatchObject({
      change: "upgraded",
      active: true,
    });
    expect(frozenDuringStop).toBe(true);
    const resumed = admission.tryAcquireWork(session);
    expect(resumed).not.toBeNull();
    admission.releaseWork(resumed);
  } finally {
    admission.unregisterSession(session);
    admission.close();
  }
});

it.each(["systemd", "launchd"])(
  "refuses a Node %s upgrade whose replacement config differs from the running definition",
  async (manager) => {
    const previous = await fixture(manager, "node");
    const replacementConfig = resolve(previous.root, "replacement.json");
    const replacementDefinition = resolve(
      previous.root,
      manager === "systemd" ? "replacement.service" : "replacement.plist",
    );
    await writeFile(replacementConfig, "{}", { mode: 0o600 });
    await renderRuntimeService([
      "--manager",
      manager,
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--executable",
      previous.executable,
      "--config",
      replacementConfig,
      "--output",
      replacementDefinition,
    ]);
    const commands = [];
    await expect(
      manageRuntimeService(
        [
          "--action",
          "upgrade",
          "--manager",
          manager,
          "--runtime",
          "node",
          "--instance",
          nodeInstance,
          "--definition",
          replacementDefinition,
          "--previous-definition",
          previous.definition,
          "--executable",
          previous.executable,
          "--config",
          replacementConfig,
          "--write",
        ],
        {
          platform: manager === "systemd" ? "linux" : "darwin",
          uid: 501,
          homeDirectory: previous.root,
          runCommand: async (...args) => {
            commands.push(args);
            return { exitCode: 0 };
          },
        },
      ),
    ).rejects.toMatchObject({ code: "service_upgrade_fence_invalid" });
    expect(commands).toEqual([]);
  },
);

it.each([false, true])(
  "keeps CLI configuration replacement frozen through success or restoration (failure=%s)",
  async (rejectReplacement) => {
    const f = await fixture("systemd", "node");
    const before = JSON.stringify({
      repositoryRoot: f.root,
      discordConversation: { deliberation: { cliExecutable: f.executable } },
    });
    await writeFile(f.config, before);
    const cli = resolve(f.root, "new-cli");
    await writeFile(cli, "#!/bin/sh\n", { mode: 0o700 });
    const candidate = resolve(f.root, "candidate.json");
    const after = JSON.parse(before);
    after.discordConversation.deliberation.cliExecutable = cli;
    await writeFile(candidate, JSON.stringify(after), { mode: 0o600 });
    const runtime = resolve(f.root, "new-runtime");
    await writeFile(runtime, "#!/bin/sh\n", { mode: 0o700 });
    const definition = resolve(f.root, "new.service");
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--executable",
      runtime,
      "--config",
      f.config,
      "--output",
      definition,
    ]);
    const admission = await SQLiteNodeWorkAdmission.open({
      path: nodeWorkAdmissionDatabasePath(f.root),
    });
    const scope = nodeWorkAdmissionScope(f.config);
    let session = admission.registerSession({
      scope,
      configDigest: `sha256:${createHash("sha256").update(before).digest("hex")}`,
    });
    const manager = systemdManager();
    const options = {
      platform: "linux",
      homeDirectory: f.root,
      wait: async () => {},
      runCommand: async (command, args) => {
        if (args[1] === "stop") {
          expect(admission.tryAcquireWork(session)).toBeNull();
          admission.unregisterSession(session);
          session = null;
        }
        if (
          (args[1] === "start" || (args[1] === "enable" && args[2] === "--now")) &&
          session === null
        ) {
          const bytes = await readFile(f.config);
          if (
            rejectReplacement &&
            JSON.parse(bytes).discordConversation.deliberation.cliExecutable === cli
          )
            return { exitCode: 1 };
          session = admission.registerSession({
            scope,
            configDigest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          });
          expect(admission.tryAcquireWork(session)).toBeNull();
        }
        return manager.run(command, args);
      },
    };
    try {
      await manageRuntimeService(f.writeArgs("install"), options);
      const args = [
        "--action",
        "upgrade",
        "--manager",
        "systemd",
        "--runtime",
        "node",
        "--instance",
        nodeInstance,
        "--definition",
        definition,
        "--previous-definition",
        f.definition,
        "--executable",
        runtime,
        "--config",
        f.config,
        "--configuration-source",
        candidate,
        "--write",
      ];
      if (rejectReplacement) {
        await expect(manageRuntimeService(args, options)).rejects.toMatchObject({
          code: "service_upgrade_failed",
        });
        expect(await readFile(f.config, "utf8")).toBe(before);
      } else {
        await expect(manageRuntimeService(args, options)).resolves.toMatchObject({
          change: "upgraded",
        });
        expect(JSON.parse(await readFile(f.config, "utf8"))).toEqual(after);
      }
      const claim = admission.tryAcquireWork(session);
      expect(claim).not.toBeNull();
      admission.releaseWork(claim);
    } finally {
      if (session) admission.unregisterSession(session);
      admission.close();
    }
  },
);

function systemdManager() {
  const calls = [];
  const enabled = new Set();
  const active = new Set();
  return {
    calls,
    async run(command, args) {
      calls.push([command, ...args]);
      if (command !== "systemctl" || args[0] !== "--user") return { exitCode: null };
      if (args[1] === "daemon-reload") return { exitCode: 0 };
      if (args[1] === "is-enabled") return { exitCode: enabled.has(args[2]) ? 0 : 1 };
      if (args[1] === "is-active") return { exitCode: active.has(args[2]) ? 0 : 3 };
      if (args[1] === "enable" && args[2] === "--now") {
        enabled.add(args[3]);
        active.add(args[3]);
        return { exitCode: 0 };
      }
      if (args[1] === "disable" && args[2] === "--now") {
        enabled.delete(args[3]);
        active.delete(args[3]);
        return { exitCode: 0 };
      }
      if (args[1] === "stop") {
        active.delete(args[2]);
        return { exitCode: 0 };
      }
      if (args[1] === "start") {
        active.add(args[2]);
        return { exitCode: 0 };
      }
      return { exitCode: 1 };
    },
  };
}

describe("runtime user service management", () => {
  it("installs, reports, idempotently reuses, and removes an exact systemd user unit", async () => {
    const value = await fixture("systemd", "hub");
    const manager = systemdManager();
    const options = {
      platform: "linux",
      homeDirectory: value.root,
      runCommand: manager.run.bind(manager),
      wait: async () => {},
    };
    await expect(manageRuntimeService(value.writeArgs("install"), options)).resolves.toMatchObject({
      manager: "systemd",
      runtime: "hub",
      installed: true,
      enabled: true,
      active: true,
      change: "installed",
    });
    const target = resolve(value.root, ".config/systemd/user/lervo-hub.service");
    expect(await readFile(target, "utf8")).toBe(await readFile(value.definition, "utf8"));
    const callsAfterInstall = manager.calls.length;
    await expect(manageRuntimeService(value.writeArgs("install"), options)).resolves.toMatchObject({
      change: "unchanged",
    });
    expect(manager.calls.length).toBe(callsAfterInstall + 2);
    await expect(
      manageRuntimeService(
        ["--action", "status", "--manager", "systemd", "--runtime", "hub"],
        options,
      ),
    ).resolves.toMatchObject({ installed: true, enabled: true, active: true });
    await expect(manageRuntimeService(value.writeArgs("remove"), options)).resolves.toMatchObject({
      change: "removed",
      installed: false,
      active: false,
    });
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("compensates when a newly activated systemd service is only transiently active", async () => {
    const value = await fixture("systemd", "hub");
    let enabled = false;
    let activeObservations = 0;
    const calls = [];
    const runCommand = async (command, args) => {
      calls.push([command, ...args]);
      if (command !== "systemctl" || args[0] !== "--user") return { exitCode: null };
      if (args[1] === "daemon-reload") return { exitCode: 0 };
      if (args[1] === "is-enabled") return { exitCode: enabled ? 0 : 1 };
      if (args[1] === "is-active") {
        if (!enabled) return { exitCode: 3 };
        activeObservations += 1;
        return { exitCode: activeObservations === 1 ? 0 : 3 };
      }
      if (args[1] === "enable" && args[2] === "--now") {
        enabled = true;
        return { exitCode: 0 };
      }
      if (args[1] === "disable" && args[2] === "--now") {
        enabled = false;
        return { exitCode: 0 };
      }
      return { exitCode: 1 };
    };
    await expect(
      manageRuntimeService(value.writeArgs("install"), {
        platform: "linux",
        homeDirectory: value.root,
        runCommand,
        wait: async () => {},
      }),
    ).rejects.toMatchObject({ code: "service_apply_failed" });
    expect(calls.some((call) => call[2] === "disable" && call[3] === "--now")).toBe(true);
    await expect(
      readFile(resolve(value.root, ".config/systemd/user/lervo-hub.service")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("waits for a transient launchd removal state before deleting the exact definition", async () => {
    const value = await fixture("launchd", "node");
    let loaded = false;
    let stopping = false;
    let removalObservations = 0;
    const runCommand = async (command, args) => {
      if (command !== "launchctl") return { exitCode: null };
      if (args[0] === "print") {
        if (stopping) {
          removalObservations += 1;
          if (removalObservations === 1) return { exitCode: 0 };
          loaded = false;
        }
        return { exitCode: loaded ? 0 : 113 };
      }
      if (args[0] === "enable") {
        return { exitCode: 0 };
      }
      if (args[0] === "bootstrap") {
        loaded = true;
        return { exitCode: 0 };
      }
      if (args[0] === "bootout") {
        stopping = true;
        return { exitCode: 0 };
      }
      if (args[0] === "disable") {
        return { exitCode: 0 };
      }
      return { exitCode: 1 };
    };
    const options = {
      platform: "darwin",
      homeDirectory: value.root,
      uid: 501,
      runCommand,
      wait: async () => {},
    };
    await expect(manageRuntimeService(value.writeArgs("install"), options)).resolves.toMatchObject({
      change: "installed",
      active: true,
    });
    await expect(manageRuntimeService(value.writeArgs("remove"), options)).resolves.toMatchObject({
      change: "removed",
      installed: false,
      active: false,
    });
    expect(removalObservations).toBeGreaterThan(1);
  });

  it("waits for launchd to finish bootout before bootstrapping an upgrade", async () => {
    const previous = await fixture("launchd", "node");
    const replacementExecutable = resolve(previous.root, "lervo-runtime-v2");
    const replacementDefinition = resolve(previous.root, "runtime-v2.plist");
    await writeFile(replacementExecutable, "#!/bin/sh\n", { mode: 0o700 });
    await chmod(replacementExecutable, 0o700);
    await renderRuntimeService([
      "--manager",
      "launchd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--executable",
      replacementExecutable,
      "--config",
      previous.config,
      "--output",
      replacementDefinition,
    ]);
    let loaded = false;
    let stopping = false;
    let stopObservations = 0;
    const runCommand = async (command, args) => {
      if (command !== "launchctl") return { exitCode: null };
      if (args[0] === "print") {
        if (stopping) {
          stopObservations += 1;
          if (stopObservations >= 2) {
            stopping = false;
            loaded = false;
          }
        }
        return { exitCode: loaded ? 0 : 113 };
      }
      if (args[0] === "enable") return { exitCode: 0 };
      if (args[0] === "bootstrap") {
        if (stopping) return { exitCode: 5 };
        loaded = true;
        return { exitCode: 0 };
      }
      if (args[0] === "bootout") {
        stopping = true;
        stopObservations = 0;
        return { exitCode: 0 };
      }
      return { exitCode: 1 };
    };
    const options = {
      platform: "darwin",
      homeDirectory: previous.root,
      uid: 501,
      runCommand,
      wait: async () => {},
      openNodeWorkAdmission: async () => openIdleNodeAdmission(),
    };
    await manageRuntimeService(previous.writeArgs("install"), options);
    await expect(
      manageRuntimeService(
        [
          "--action",
          "upgrade",
          "--manager",
          "launchd",
          "--runtime",
          "node",
          "--instance",
          nodeInstance,
          "--definition",
          replacementDefinition,
          "--previous-definition",
          previous.definition,
          "--executable",
          replacementExecutable,
          "--config",
          previous.config,
          "--write",
        ],
        options,
      ),
    ).resolves.toMatchObject({ change: "upgraded", active: true });
    expect(stopObservations).toBeGreaterThan(1);
  });

  it("requires explicit write authority and never overwrites another definition", async () => {
    const value = await fixture("systemd", "node");
    const manager = systemdManager();
    const options = {
      platform: "linux",
      homeDirectory: value.root,
      runCommand: manager.run.bind(manager),
    };
    await expect(
      manageRuntimeService(
        value.writeArgs("install").filter((arg) => arg !== "--write"),
        options,
      ),
    ).rejects.toMatchObject({ code: "write_not_authorized" });
    const target = resolve(
      value.root,
      ".config/systemd/user/lervo-node-0123456789abcdef01234567.service",
    );
    await writeFile(target, "unrelated unit\n", { mode: 0o600 }).catch(async (error) => {
      if (error.code !== "ENOENT") throw error;
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, "unrelated unit\n", { mode: 0o600 });
    });
    await expect(manageRuntimeService(value.writeArgs("install"), options)).rejects.toMatchObject({
      code: "service_state_conflict",
    });
    expect(await readFile(target, "utf8")).toBe("unrelated unit\n");
    expect(manager.calls).toHaveLength(0);
  });

  it("upgrades an exact active service and can roll it back to the bound predecessor", async () => {
    const previous = await fixture("systemd", "node");
    const replacementExecutable = resolve(previous.root, "lervo-runtime-v2");
    const replacementDefinition = resolve(previous.root, "runtime-v2.service");
    await writeFile(replacementExecutable, "#!/bin/sh\n", { mode: 0o700 });
    await chmod(replacementExecutable, 0o700);
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--executable",
      replacementExecutable,
      "--config",
      previous.config,
      "--output",
      replacementDefinition,
    ]);
    const manager = systemdManager();
    const options = {
      platform: "linux",
      homeDirectory: previous.root,
      runCommand: manager.run.bind(manager),
      wait: async () => {},
      openNodeWorkAdmission: async () => openIdleNodeAdmission(),
    };
    await manageRuntimeService(previous.writeArgs("install"), options);
    const upgradeArgs = [
      "--action",
      "upgrade",
      "--manager",
      "systemd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--definition",
      replacementDefinition,
      "--previous-definition",
      previous.definition,
      "--executable",
      replacementExecutable,
      "--config",
      previous.config,
      "--write",
    ];
    await expect(manageRuntimeService(upgradeArgs, options)).resolves.toMatchObject({
      change: "upgraded",
      active: true,
    });
    const target = resolve(
      previous.root,
      ".config/systemd/user/lervo-node-0123456789abcdef01234567.service",
    );
    expect(await readFile(target, "utf8")).toBe(await readFile(replacementDefinition, "utf8"));
    const rollbackArgs = [
      "--action",
      "rollback",
      "--manager",
      "systemd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--definition",
      replacementDefinition,
      "--previous-definition",
      previous.definition,
      "--executable",
      replacementExecutable,
      "--config",
      previous.config,
      "--write",
    ];
    await expect(manageRuntimeService(rollbackArgs, options)).resolves.toMatchObject({
      change: "rolled_back",
      active: true,
    });
    expect(await readFile(target, "utf8")).toBe(await readFile(previous.definition, "utf8"));
  });

  it("reconciles an ambiguous slow stop before replacing an operational service", async () => {
    const previous = await fixture("systemd", "hub");
    const replacementExecutable = resolve(previous.root, "lervo-runtime-v2");
    const replacementDefinition = resolve(previous.root, "runtime-v2.service");
    await writeFile(replacementExecutable, "#!/bin/sh\n", { mode: 0o700 });
    await chmod(replacementExecutable, 0o700);
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "hub",
      "--executable",
      replacementExecutable,
      "--config",
      previous.config,
      "--output",
      replacementDefinition,
    ]);
    const manager = systemdManager();
    const options = {
      platform: "linux",
      homeDirectory: previous.root,
      runCommand: manager.run.bind(manager),
      wait: async () => {},
    };
    await manageRuntimeService(previous.writeArgs("install"), options);
    let stopTimeoutMs;
    const upgradeArgs = [
      "--action",
      "upgrade",
      "--manager",
      "systemd",
      "--runtime",
      "hub",
      "--definition",
      replacementDefinition,
      "--previous-definition",
      previous.definition,
      "--executable",
      replacementExecutable,
      "--config",
      previous.config,
      "--write",
    ];
    await expect(
      manageRuntimeService(upgradeArgs, {
        ...options,
        runCommand: async (command, args, commandOptions) => {
          if (command === "systemctl" && args[1] === "stop") {
            stopTimeoutMs = commandOptions?.timeoutMs;
            await manager.run(command, args);
            return { exitCode: null };
          }
          return manager.run(command, args);
        },
      }),
    ).resolves.toMatchObject({ change: "upgraded", active: true });
    expect(stopTimeoutMs).toBeGreaterThan(runtimeServiceStopTimeoutMs);
    expect(
      await readFile(resolve(previous.root, ".config/systemd/user/lervo-hub.service"), "utf8"),
    ).toBe(await readFile(replacementDefinition, "utf8"));

    await expect(
      manageRuntimeService(
        [
          "--action",
          "rollback",
          "--manager",
          "systemd",
          "--runtime",
          "hub",
          "--definition",
          replacementDefinition,
          "--previous-definition",
          previous.definition,
          "--executable",
          replacementExecutable,
          "--config",
          previous.config,
          "--write",
        ],
        options,
      ),
    ).resolves.toMatchObject({ change: "rolled_back", active: true });
    await expect(
      manageRuntimeService(upgradeArgs, {
        ...options,
        runCommand: async (command, args) =>
          command === "systemctl" && args[1] === "stop"
            ? { exitCode: null }
            : manager.run(command, args),
      }),
    ).rejects.toMatchObject({ code: "service_upgrade_failed" });
    expect(
      await readFile(resolve(previous.root, ".config/systemd/user/lervo-hub.service"), "utf8"),
    ).toBe(await readFile(previous.definition, "utf8"));
  });

  it("does not upgrade an inactive Node without a participating admission session", async () => {
    const previous = await fixture("systemd", "node");
    const replacementExecutable = resolve(previous.root, "lervo-runtime-v2");
    const replacementDefinition = resolve(previous.root, "runtime-v2.service");
    await writeFile(replacementExecutable, "#!/bin/sh\n", { mode: 0o700 });
    await chmod(replacementExecutable, 0o700);
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--executable",
      replacementExecutable,
      "--config",
      previous.config,
      "--output",
      replacementDefinition,
    ]);
    const manager = systemdManager();
    const options = {
      platform: "linux",
      homeDirectory: previous.root,
      runCommand: manager.run.bind(manager),
      wait: async () => {},
    };
    await manageRuntimeService(previous.writeArgs("install"), options);
    await manager.run("systemctl", [
      "--user",
      "stop",
      `lervo-node-${nodeInstance.slice(4)}.service`,
    ]);

    await expect(
      manageRuntimeService(
        [
          "--action",
          "upgrade",
          "--manager",
          "systemd",
          "--runtime",
          "node",
          "--instance",
          nodeInstance,
          "--definition",
          replacementDefinition,
          "--previous-definition",
          previous.definition,
          "--executable",
          replacementExecutable,
          "--config",
          previous.config,
          "--write",
        ],
        options,
      ),
    ).rejects.toMatchObject({ code: "service_upgrade_fence_invalid" });
    expect(
      await readFile(
        resolve(previous.root, ".config/systemd/user/lervo-node-0123456789abcdef01234567.service"),
        "utf8",
      ),
    ).toBe(await readFile(previous.definition, "utf8"));
  });

  it("rejects a symlinked definition before invoking the manager", async () => {
    if (process.platform === "win32") return;
    const value = await fixture("systemd", "hub");
    const definitionLink = resolve(value.root, "definition-link.service");
    await symlink(value.definition, definitionLink);
    const args = value.writeArgs("install");
    args[args.indexOf(value.definition)] = definitionLink;
    const manager = systemdManager();
    await expect(
      manageRuntimeService(args, {
        platform: "linux",
        homeDirectory: value.root,
        runCommand: manager.run.bind(manager),
      }),
    ).rejects.toMatchObject({ code: "unsafe_service_definition" });
    expect(manager.calls).toHaveLength(0);
  });

  it("compensates a failed launchd bootstrap back to the uninstalled state", async () => {
    const value = await fixture("launchd", "hub");
    let enabled = false;
    let loaded = false;
    const calls = [];
    const runCommand = async (command, args) => {
      calls.push([command, ...args]);
      if (command !== "launchctl") return { exitCode: null };
      if (args[0] === "print") return { exitCode: loaded ? 0 : 113 };
      if (args[0] === "enable") {
        enabled = true;
        return { exitCode: 0 };
      }
      if (args[0] === "bootstrap") return { exitCode: 5 };
      if (args[0] === "bootout") {
        loaded = false;
        return { exitCode: 113 };
      }
      if (args[0] === "disable") {
        enabled = false;
        return { exitCode: 0 };
      }
      return { exitCode: 1 };
    };
    await expect(
      manageRuntimeService(value.writeArgs("install"), {
        platform: "darwin",
        homeDirectory: value.root,
        uid: 501,
        runCommand,
      }),
    ).rejects.toMatchObject({ code: "service_apply_failed" });
    expect(enabled).toBe(false);
    expect(loaded).toBe(false);
    const target = resolve(value.root, "Library/LaunchAgents/com.lervo.hub.plist");
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls.some((call) => call[1] === "disable")).toBe(true);
  });

  it("reports manager unavailability without treating it as an inactive service", async () => {
    const value = await fixture("launchd", "node");
    const options = {
      platform: "darwin",
      homeDirectory: value.root,
      uid: 501,
      runCommand: async () => ({ exitCode: null }),
    };
    await expect(
      manageRuntimeService(
        [
          "--",
          "--action",
          "status",
          "--manager",
          "launchd",
          "--runtime",
          "node",
          "--instance",
          nodeInstance,
        ],
        options,
      ),
    ).resolves.toMatchObject({
      managerAvailable: false,
      installed: false,
      active: false,
    });
    await expect(manageRuntimeService(value.writeArgs("install"), options)).rejects.toMatchObject({
      code: "service_manager_unavailable",
    });
    await expect(
      readFile(
        resolve(value.root, "Library/LaunchAgents/com.lervo.node.0123456789abcdef01234567.plist"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps two repository Node instances independently addressable", async () => {
    const first = await fixture("systemd", "node");
    const second = await fixture("systemd", "node");
    const secondInstance = "nfi_89abcdef0123456701234567";
    const secondDefinition = resolve(second.root, "second.service");
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "node",
      "--instance",
      secondInstance,
      "--executable",
      second.executable,
      "--config",
      second.config,
      "--output",
      secondDefinition,
    ]);
    const secondArgs = [
      "--action",
      "install",
      "--manager",
      "systemd",
      "--runtime",
      "node",
      "--instance",
      secondInstance,
      "--definition",
      secondDefinition,
      "--executable",
      second.executable,
      "--config",
      second.config,
      "--write",
    ];
    const manager = systemdManager();
    const options = {
      platform: "linux",
      homeDirectory: first.root,
      runCommand: manager.run.bind(manager),
      wait: async () => {},
    };
    await expect(manageRuntimeService(first.writeArgs("install"), options)).resolves.toMatchObject({
      serviceIdentity: "lervo-node-0123456789abcdef01234567.service",
    });
    await expect(manageRuntimeService(secondArgs, options)).resolves.toMatchObject({
      serviceIdentity: "lervo-node-89abcdef0123456701234567.service",
    });
    expect(
      await readFile(
        resolve(first.root, ".config/systemd/user/lervo-node-0123456789abcdef01234567.service"),
        "utf8",
      ),
    ).toBe(await readFile(first.definition, "utf8"));
    expect(
      await readFile(
        resolve(first.root, ".config/systemd/user/lervo-node-89abcdef0123456701234567.service"),
        "utf8",
      ),
    ).toBe(await readFile(secondDefinition, "utf8"));
  });
});
