import { lstat, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runHostCommand, type HostCommandOverrides } from "../src/host-command.js";
import { parseHostFollowArguments } from "../src/host-follow-arguments.js";
import type { HostFollowCycleResult } from "../src/host-follow-cycle.js";
import {
  HOST_FOLLOW_HANDOVER_EXIT_CODE,
  runFollowLoop,
  withFollowLock,
} from "../src/host-follow-loop.js";
import { FOLLOW_POLL_INTERVAL_MS } from "../src/host-follow-policy.js";
import { readActiveCli } from "../src/host-follow-runtime.js";
import type { HostFollowServicePorts } from "../src/host-follow-service.js";
import { readFollowControl } from "../src/host-follow-state.js";
import type { ManagedServiceStatus } from "../src/managed-user-service-write.js";
import {
  cleanDirectories,
  followHarness,
  release,
  type FollowHarness,
} from "./host-follow-fixture.js";
import { extractingInstaller } from "./host-release-fixture.js";

afterEach(cleanDirectories);

function capture() {
  const output: string[] = [];
  return {
    output,
    io: {
      cwd: "/",
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => output.push(text),
    },
    json: () => JSON.parse(output.pop() as string) as Record<string, unknown>,
  };
}

function fakeServicePorts(home: string, calls: string[][]): HostFollowServicePorts {
  let installed = false;
  return {
    platform: "linux",
    homeDirectory: home,
    uid: 1000,
    searchPath: "/opt/gh/bin:relative/bin:/usr/bin",
    nodeExecutable: async () => process.execPath,
    async manage(args): Promise<ManagedServiceStatus> {
      calls.push(args);
      const action = args[args.indexOf("--action") + 1];
      if (action === "install") installed = true;
      if (action === "remove") installed = false;
      return {
        managerAvailable: true,
        installed,
        enabled: installed,
        active: installed,
        ...(action === "status" ? {} : { change: action }),
      };
    },
  };
}

function overrides(
  harness: FollowHarness,
  servicePorts?: HostFollowServicePorts,
): HostCommandOverrides {
  return {
    homeDirectory: harness.home,
    platform: "linux",
    createSource: () => harness.source,
    installer: extractingInstaller,
    now: harness.upgrade.now,
    follow: {
      listRepositories: harness.dependencies.listRepositories,
      runRepositoryUpgrade: harness.dependencies.runRepositoryUpgrade,
      runningInstallRoot: harness.dependencies.runningInstallRoot,
      ...(servicePorts === undefined ? {} : { servicePorts }),
    },
  };
}

const cycleResult = (fields: Partial<HostFollowCycleResult>): HostFollowCycleResult => ({
  outcome: "current",
  tag: null,
  code: null,
  activationId: null,
  pass: null,
  handover: false,
  consecutiveSourceFailures: 0,
  ...fields,
});

describe("lervo host upgrade --follow", () => {
  it("plans without writing, then follows one cycle with no Hub configured", async () => {
    const harness = await followHarness();
    harness.releases.push(release("9.9.10"));
    const { io, json, output } = capture();
    const base = ["upgrade", "--follow", "--json"];
    expect(await runHostCommand(base, io, overrides(harness))).toBe(0);
    expect(json()).toMatchObject({
      operation: "host_follow_plan",
      repository: "owner/lervo",
      next: "repository_pass",
      activeVersion: "9.9.9",
    });
    expect(await runHostCommand(["upgrade", "--follow"], io, overrides(harness))).toBe(0);
    expect(output.pop()).toContain("Follow plan for owner/lervo: repository_pass");
    expect(await lstat(harness.layout.follow.statePath).catch(() => null)).toBeNull();
    // Nothing configures a Hub: the follower reads only GitHub Releases and this host.
    expect(await runHostCommand([...base, "--apply", "--once"], io, overrides(harness))).toBe(0);
    expect(json()).toMatchObject({
      operation: "host_follow_cycle",
      outcome: "repositories_upgraded",
    });
    expect(await runHostCommand([...base, "--apply", "--once"], io, overrides(harness))).toBe(0);
    expect(json()).toMatchObject({ outcome: "upgraded", tag: "v9.9.10", handover: true });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.10");
  });

  it("pauses, pins, and resumes on this host", async () => {
    const harness = await followHarness();
    const { io, json } = capture();
    const ports = fakeServicePorts(harness.home, []);
    const run = (...args: string[]) =>
      runHostCommand(["upgrade", "--follow", ...args, "--json"], io, overrides(harness, ports));
    expect(await run("--pause")).toBe(0);
    expect(json()).toMatchObject({ control: { paused: true, pinnedTag: null } });
    expect(await run("--pin", "v9.9.10")).toBe(0);
    expect(await readFollowControl(harness.layout)).toMatchObject({
      paused: true,
      pinnedTag: "v9.9.10",
    });
    expect(await run("--resume")).toBe(0);
    expect(await readFollowControl(harness.layout)).toMatchObject({
      paused: false,
      pinnedTag: null,
    });
    expect(await run("--status")).toBe(0);
    expect(json()).toMatchObject({
      operation: "host_follow_status",
      activeVersion: "9.9.9",
      service: { installed: false },
    });
  });

  it("refuses a second follower on the same host", async () => {
    const harness = await followHarness();
    await mkdir(harness.layout.cliDirectory, { recursive: true });
    await writeFile(harness.layout.follow.lockPath, `${process.pid}\n`);
    const { io, json } = capture();
    expect(
      await runHostCommand(
        ["upgrade", "--follow", "--apply", "--once", "--json"],
        io,
        overrides(harness),
      ),
    ).toBe(1);
    expect(json()).toMatchObject({ error: { code: "host_follow_in_progress" } });
    await expect(withFollowLock(harness.layout, async () => 0)).rejects.toMatchObject({
      code: "host_follow_in_progress",
    });
  });

  it("installs the follower service on the runtime link and keeps the shell PATH", async () => {
    const harness = await followHarness();
    const calls: string[][] = [];
    const ports = fakeServicePorts(harness.home, calls);
    const { io, json } = capture();
    const run = (...args: string[]) =>
      runHostCommand(["upgrade", "--follow", ...args, "--json"], io, overrides(harness, ports));
    expect(await run("--service", "install")).toBe(0);
    expect(json()).toMatchObject({ action: "install", configAction: "create" });
    expect(await lstat(harness.layout.follow.runtimePointer).catch(() => null)).toBeNull();
    expect(await run("--service", "install", "--apply")).toBe(0);
    expect(json()).toMatchObject({
      operation: "host_follow_service",
      serviceIdentity: "lervo-host-follow.service",
      change: "install",
    });
    expect(await readlink(harness.layout.follow.runtimePointer)).toBe(
      (await readActiveCli(harness.layout)).packageRoot,
    );
    expect(JSON.parse(await readFile(harness.layout.follow.configPath, "utf8"))).toEqual({
      schemaVersion: 1,
      repository: null,
      binDirectory: harness.layout.binDirectory,
      searchPath: "/opt/gh/bin:/usr/bin",
    });
    // The fake manager writes no unit file; place one where systemd keeps it, then remove it.
    const unit = resolve(harness.home, ".config", "systemd", "user", "lervo-host-follow.service");
    await mkdir(resolve(unit, ".."), { recursive: true });
    await writeFile(unit, "[Unit]\n");
    expect(await run("--service", "remove", "--apply")).toBe(0);
    expect(json()).toMatchObject({ request: "remove", action: "remove", change: "remove" });
    expect(calls.some((args) => args.includes("remove"))).toBe(true);
    const install = calls.find((args) => args.includes("install")) as string[];
    expect(install).toEqual(
      expect.arrayContaining([
        "--runtime",
        "host-follow",
        "--executable",
        resolve(harness.layout.follow.runtimePointer, "dist", "bin.js"),
        "--config",
        harness.layout.follow.configPath,
        "--write",
      ]),
    );
  });

  it("parses only coherent follow arguments", () => {
    expect(parseHostFollowArguments(["--follow", "--apply", "--once"]).mode).toEqual({
      kind: "run",
      once: true,
    });
    for (const args of [
      ["--follow", "--once"],
      ["--follow", "--pause", "--resume"],
      ["--follow", "--pin", "latest"],
      ["--follow", "--pause", "--apply"],
      ["--follow", "--service", "restart"],
      ["--follow", "--config", "/c.json"],
      ["--follow", "--apply", "--config", "/c.json", "--repository", "a/b"],
      ["--follow", "--repository", "../x"],
      ["--follow", "--bin-directory", "relative"],
    ]) {
      let failure: unknown = null;
      try {
        parseHostFollowArguments(args);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: "host_upgrade_arguments_invalid" });
    }
  });

  it("follows the repository this host last installed from, and asks once when none", async () => {
    const harness = await followHarness();
    const seen: string[] = [];
    const recording = {
      ...overrides(harness),
      createSource: (repository: string) => {
        seen.push(repository);
        return harness.source;
      },
    };
    const { io, json } = capture();
    expect(await runHostCommand(["upgrade", "--follow", "--json"], io, recording)).toBe(0);
    expect(seen).toEqual(["owner/lervo"]);
    // A host whose journal names no install source refuses until --repository names one.
    await rm(harness.layout.journalPath);
    expect(await runHostCommand(["upgrade", "--follow", "--json"], io, recording)).toBe(1);
    expect(json()).toMatchObject({ error: { code: "host_follow_repository_unknown" } });
    const ports = fakeServicePorts(harness.home, []);
    const service = (...args: string[]) =>
      runHostCommand(
        ["upgrade", "--follow", "--service", "install", ...args, "--json"],
        io,
        overrides(harness, ports),
      );
    expect(await service()).toBe(1);
    expect(json()).toMatchObject({ blocker: { code: "host_follow_repository_unknown" } });
    expect(await service("--repository", "owner/lervo")).toBe(0);
    expect(json()).toMatchObject({ blocker: null });
    expect(
      await runHostCommand(
        ["upgrade", "--follow", "--repository", "owner/lervo", "--json"],
        io,
        recording,
      ),
    ).toBe(0);
  });
});

describe("runFollowLoop", () => {
  it("sleeps with jitter and backoff, then exits for the service manager on handover", async () => {
    const harness = await followHarness();
    const results = [
      cycleResult({ outcome: "current" }),
      cycleResult({ outcome: "source_unavailable", consecutiveSourceFailures: 1 }),
      null,
      cycleResult({ outcome: "upgraded", handover: true }),
    ];
    const delays: number[] = [];
    const lines: string[] = [];
    const code = await runFollowLoop({
      layout: harness.layout,
      runCycle: async () => {
        const next = results.shift();
        if (next === null)
          throw Object.assign(new Error("damaged"), { code: "host_follow_state_invalid" });
        return next as HostFollowCycleResult;
      },
      random: () => 0,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
      log: (line) => lines.push(line),
      now: harness.upgrade.now,
      signal: new AbortController().signal,
    });
    expect(code).toBe(HOST_FOLLOW_HANDOVER_EXIT_CODE);
    expect(delays).toEqual([
      Math.round(FOLLOW_POLL_INTERVAL_MS * 0.8),
      Math.round(2 * FOLLOW_POLL_INTERVAL_MS * 0.8),
      Math.round(2 * FOLLOW_POLL_INTERVAL_MS * 0.8),
    ]);
    expect(lines.map((line) => (JSON.parse(line) as { outcome: string }).outcome)).toEqual([
      "current",
      "source_unavailable",
      "cycle_failed",
      "upgraded",
    ]);
    // The lock is released for the restarted follower.
    await expect(withFollowLock(harness.layout, async () => "free")).resolves.toBe("free");
  });

  it("stops cleanly when the service manager stops it", async () => {
    const harness = await followHarness();
    const controller = new AbortController();
    let cycles = 0;
    const code = await runFollowLoop({
      layout: harness.layout,
      runCycle: async () => {
        cycles += 1;
        controller.abort();
        return cycleResult({});
      },
      random: Math.random,
      sleep: async () => undefined,
      log: () => undefined,
      now: harness.upgrade.now,
      signal: controller.signal,
    });
    expect([code, cycles]).toEqual([0, 1]);
  });
});
