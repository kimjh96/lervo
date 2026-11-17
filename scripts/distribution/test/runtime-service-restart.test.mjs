import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { manageRuntimeService } from "../manage-runtime-service.mjs";
import { renderRuntimeService } from "../render-runtime-service.mjs";

const roots = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

const targets = {
  systemd: ".config/systemd/user/lervo-repository-replica.service",
  launchd: "Library/LaunchAgents/dev.lervo.repository-replica.plist",
};

/** An installed replica coordinator definition and the canonical arguments that render it. */
async function installedReplica(manager) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-service-restart-"));
  roots.push(root);
  const executable = resolve(root, "node-runtime.js");
  const config = resolve(root, "repository-replica-coordinator.json");
  const definition = resolve(root, "replica.definition");
  await writeFile(executable, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  await writeFile(config, "{}\n", { mode: 0o600 });
  await renderRuntimeService([
    "--manager",
    manager,
    "--runtime",
    "repository-replica",
    "--executable",
    executable,
    "--config",
    config,
    "--output",
    definition,
  ]);
  const target = resolve(root, targets[manager]);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, await readFile(definition), { mode: 0o600 });
  await chmod(target, 0o600);
  const writeArgs = (action, runtime = "repository-replica") => [
    "--action",
    action,
    "--manager",
    manager,
    "--runtime",
    runtime,
    ...(runtime === "node" ? ["--instance", "nfi_0123456789abcdef01234567"] : []),
    "--definition",
    definition,
    "--executable",
    executable,
    "--config",
    config,
    "--write",
  ];
  return { root, target, definition, writeArgs };
}

/** systemd as the manager observes it: one running unit whose MainPID changes on start. */
function systemd(processId = 100) {
  const state = { active: true, processId, calls: [] };
  const runCommand = async (command, args) => {
    state.calls.push([command, ...args].join(" "));
    if (command !== "systemctl") return { exitCode: null };
    const verb = args[1];
    if (verb === "is-enabled") return { exitCode: 0 };
    if (verb === "is-active") return { exitCode: state.active ? 0 : 3 };
    if (verb === "show") return { exitCode: 0, stdout: `${state.active ? state.processId : 0}\n` };
    if (verb === "stop") state.active = false;
    if (verb === "start") Object.assign(state, { active: true, processId: state.processId + 1 });
    return { exitCode: 0 };
  };
  return { state, runCommand };
}

/** launchd as the manager observes it: the job's own top-level `pid` line names its process. */
function launchd(processId = 500) {
  const state = { loaded: true, processId, calls: [] };
  const runCommand = async (command, args) => {
    state.calls.push([command, ...args].join(" "));
    if (command !== "launchctl") return { exitCode: null };
    if (args[0] === "print")
      return state.loaded
        ? {
            exitCode: 0,
            stdout: `gui/501/dev.lervo.repository-replica = {\n\tstate = running\n\tpid = ${state.processId}\n\tendpoints = {\n\t\tpid = 1\n\t}\n}\n`,
          }
        : { exitCode: 113, stdout: "" };
    if (args[0] === "bootout") state.loaded = false;
    if (args[0] === "bootstrap")
      Object.assign(state, { loaded: true, processId: state.processId + 1 });
    return { exitCode: 0 };
  };
  return { state, runCommand };
}

const fakes = { systemd, launchd };
const platforms = { systemd: "linux", launchd: "darwin" };

describe("same-definition restart (ADR-0573)", () => {
  for (const manager of ["systemd", "launchd"]) {
    it(`reports the running process id and restarts the exact definition under ${manager}`, async () => {
      const value = await installedReplica(manager);
      const fake = fakes[manager]();
      const options = {
        platform: platforms[manager],
        homeDirectory: value.root,
        uid: 501,
        runCommand: fake.runCommand,
        wait: async () => undefined,
      };
      const status = () =>
        manageRuntimeService(
          ["--action", "status", "--manager", manager, "--runtime", "repository-replica"],
          options,
        );
      const before = fake.state.processId;
      await expect(status()).resolves.toMatchObject({ active: true, processId: before });
      const definition = await readFile(value.target);

      await expect(
        manageRuntimeService(value.writeArgs("restart"), options),
      ).resolves.toMatchObject({ change: "restarted", installed: true, active: true });
      expect(await readFile(value.target)).toEqual(definition);
      const stop = manager === "systemd" ? "systemctl --user stop" : "launchctl bootout";
      const start = manager === "systemd" ? "systemctl --user start" : "launchctl bootstrap";
      const stopAt = fake.state.calls.findIndex((call) => call.startsWith(stop));
      expect(stopAt).toBeGreaterThan(-1);
      expect(fake.state.calls.findIndex((call) => call.startsWith(start))).toBeGreaterThan(stopAt);
      await expect(status()).resolves.toMatchObject({ processId: before + 1 });
    });
  }

  it("reports no process id for a stopped unit or an unreadable manager answer", async () => {
    const value = await installedReplica("systemd");
    const fake = systemd();
    fake.state.active = false;
    const args = ["--action", "status", "--manager", "systemd", "--runtime", "repository-replica"];
    const options = { platform: "linux", homeDirectory: value.root, runCommand: fake.runCommand };
    await expect(manageRuntimeService(args, options)).resolves.toMatchObject({
      active: false,
      processId: null,
    });
    fake.state.active = true;
    const garbled = async (command, commandArgs, commandOptions) =>
      commandArgs[1] === "show"
        ? { exitCode: 0, stdout: "MainPID=100\n" }
        : fake.runCommand(command, commandArgs, commandOptions);
    await expect(
      manageRuntimeService(args, { ...options, runCommand: garbled }),
    ).resolves.toMatchObject({ active: true, processId: null });
  });

  it("refuses to restart a definition that differs, a Node service, or without --write", async () => {
    const value = await installedReplica("systemd");
    const fake = systemd();
    const options = {
      platform: "linux",
      homeDirectory: value.root,
      runCommand: fake.runCommand,
      wait: async () => undefined,
    };
    await writeFile(value.target, "[Service]\nExecStart=/opt/other\n", { mode: 0o600 });
    await expect(manageRuntimeService(value.writeArgs("restart"), options)).rejects.toMatchObject({
      code: "service_state_conflict",
    });
    await expect(
      manageRuntimeService(value.writeArgs("restart", "node"), options),
    ).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(
      manageRuntimeService(
        value.writeArgs("restart").filter((item) => item !== "--write"),
        options,
      ),
    ).rejects.toMatchObject({ code: "write_not_authorized" });
    expect(fake.state.calls.some((call) => call.includes("stop"))).toBe(false);
  });
});
