import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { nodeRuntimesDirectory, pointCurrentNodeRuntime } from "../src/node-runtime-pointer.js";
import {
  applyNodeRuntimeRetention,
  planNodeRuntimeRetention,
} from "../src/node-runtime-retention.js";
import { pinRuntimeRollbackPredecessor } from "../src/node-runtime-rollback-pins.js";
import {
  journalRuntimeRetirement,
  recoverRuntimeRetirement,
} from "../src/node-runtime-retirement-journal.js";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
const name = (index: number) => index.toString(16).padStart(16, "0");

async function runtimeHome(platform: "darwin" | "linux", total = 9) {
  const homeDirectory = await realpath(
    await mkdtemp(resolve(tmpdir(), "lervo-runtime-retention-")),
  );
  homes.push(homeDirectory);
  const root = nodeRuntimesDirectory(homeDirectory, platform);
  for (let i = 1; i <= total; i++) {
    const directory = resolve(root, name(i));
    await mkdir(directory, { recursive: true });
    const payload = resolve(directory, "node-runtime.js");
    await writeFile(payload, "export {};\n");
    await writeFile(
      resolve(directory, `lervo-node-launcher-${name(i).slice(0, 12)}`),
      `#!/bin/sh\nexec '/node' '${payload}' "$@"\n`,
    );
    await utimes(directory, new Date(i * 1000), new Date(i * 1000));
  }
  await pointCurrentNodeRuntime({ runtimeDirectory: name(1), homeDirectory, platform });
  return { root, homeDirectory, platform };
}

for (const platform of ["darwin", "linux"] as const) {
  it(`keeps current, running payloads and launchers, rollback, configured services and two recent others on ${platform}`, async () => {
    const f = await runtimeHome(platform);
    const serviceDirectory =
      platform === "darwin"
        ? resolve(f.homeDirectory, "Library/LaunchAgents")
        : resolve(f.homeDirectory, ".config/systemd/user");
    await mkdir(serviceDirectory, { recursive: true });
    const config = resolve(f.homeDirectory, "node.json");
    await writeFile(
      config,
      JSON.stringify({ executable: resolve(f.root, name(5), "node-runtime.js") }),
    );
    const executable = resolve(f.root, name(4), `lervo-node-launcher-${name(4).slice(0, 12)}`);
    await writeFile(
      resolve(
        serviceDirectory,
        platform === "darwin" ? "com.lervo.node.test.plist" : "lervo-node-test.service",
      ),
      platform === "darwin"
        ? `<key>ProgramArguments</key><array><string>${executable}</string><string>--config</string><string>${config}</string></array>`
        : `ExecStart="${executable}" --config "${config}"\n`,
    );
    await pinRuntimeRollbackPredecessor({
      ...f,
      servicePath: "service-test",
      definition: resolve(f.root, name(3), "node-runtime.js"),
    });
    const options = {
      ...f,
      processCommands: async () =>
        `42 /node ${resolve(f.root, name(2), "node-runtime.js")}\n43 ${resolve(f.root, name(6), `lervo-node-launcher-${name(6).slice(0, 12)}`)}`,
    };
    const plan = await planNodeRuntimeRetention(options);
    expect(plan.candidates.map((item) => item.name)).toEqual([name(7)]);
    expect(await applyNodeRuntimeRetention(plan, options)).toBe(1);
    await expect(readFile(resolve(f.root, name(7), "node-runtime.js"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    for (const i of [1, 2, 3, 4, 5, 6, 8, 9])
      expect(await readFile(resolve(f.root, name(i), "node-runtime.js"), "utf8")).toBe(
        "export {};\n",
      );
  });
}

it("rejects foreign layout and external links, and accepts generated internal dependency links without following them", async () => {
  const f = await runtimeHome("linux");
  const outside = resolve(f.homeDirectory, "outside");
  await mkdir(outside);
  await writeFile(resolve(outside, "owner.txt"), "keep");
  await rm(resolve(f.root, name(2)), { recursive: true });
  await symlink(outside, resolve(f.root, name(2)));
  await symlink(outside, resolve(f.root, name(3), "node_modules"));
  await writeFile(resolve(f.root, name(4), "owner.txt"), "foreign");
  const modules = resolve(f.root, name(5), "node_modules");
  await mkdir(resolve(modules, ".lervo-packages/0"), { recursive: true });
  await symlink(".lervo-packages/0", resolve(modules, "dependency"));
  // Creating node_modules refreshed the mtime; restore it so recency does not keep this runtime.
  await utimes(resolve(f.root, name(5)), new Date(5000), new Date(5000));
  const options = { ...f, processCommands: async () => "" };
  const plan = await planNodeRuntimeRetention(options);
  expect(plan.candidates.map((item) => item.name)).toContain(name(5));
  for (const index of [2, 3, 4])
    expect(plan.candidates.map((item) => item.name)).not.toContain(name(index));
  await applyNodeRuntimeRetention(plan, options);
  expect(await readFile(resolve(outside, "owner.txt"), "utf8")).toBe("keep");
  expect(await readFile(resolve(f.root, name(4), "owner.txt"), "utf8")).toBe("foreign");
});

it("rechecks a process started after approval, and defers an unbound process using current", async () => {
  const f = await runtimeHome("linux");
  let commands = "";
  const options = { ...f, processCommands: async () => commands };
  const plan = await planNodeRuntimeRetention(options);
  commands = `42 /node ${resolve(f.root, name(2), "node-runtime.js")}`;
  await applyNodeRuntimeRetention(plan, options);
  expect(await readFile(resolve(f.root, name(2), "node-runtime.js"), "utf8")).toBe("export {};\n");
  commands = `42 /node ${resolve(f.root, "current/node-runtime.js")}`;
  expect(await planNodeRuntimeRetention(options)).toMatchObject({
    disposition: "deferred",
    candidates: [],
  });
});

it("resumes an interrupted runtime detach without touching the outside tree", async () => {
  const f = await runtimeHome("linux");
  const retired = `.retired-${name(2)}-00000000-0000-0000-0000-000000000000`;
  await journalRuntimeRetirement(f.root, name(2), retired);
  await rename(resolve(f.root, name(2)), resolve(f.root, retired));
  await recoverRuntimeRetirement(f.root);
  await expect(readFile(resolve(f.root, retired, "node-runtime.js"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await readFile(resolve(f.root, name(1), "node-runtime.js"), "utf8")).toBe("export {};\n");
});

it("keeps a physical process binding after current moves and records an exact rollback from a stable pointer", async () => {
  const f = await runtimeHome("linux");
  await pinRuntimeRollbackPredecessor({
    ...f,
    servicePath: "stable-service",
    definition: resolve(f.root, "current/node-runtime.js"),
  });
  await pointCurrentNodeRuntime({ ...f, runtimeDirectory: name(9) });
  const bindings = resolve(f.root, name(2), ".processes");
  await mkdir(bindings);
  await writeFile(
    resolve(bindings, `${process.pid}.json`),
    JSON.stringify({
      schemaVersion: 1,
      processId: process.pid,
      processIdentity: `proc_test_v1:sha256:${"a".repeat(64)}`,
      runtimeDirectory: name(2),
    }),
  );
  const options = {
    ...f,
    processCommands: async () =>
      `${process.pid} /node ${resolve(f.root, "current/node-runtime.js")}`,
    observeProcess: () => ({
      status: "present" as const,
      identity: `proc_test_v1:sha256:${"a".repeat(64)}`,
    }),
  };
  const plan = await planNodeRuntimeRetention(options);
  expect(plan.disposition).toBe("safe_apply");
  expect(plan.candidates.map((item) => item.name)).not.toContain(name(1));
  expect(plan.candidates.map((item) => item.name)).not.toContain(name(2));
  await applyNodeRuntimeRetention(plan, options);
  for (const index of [1, 2, 9])
    expect(await readFile(resolve(f.root, name(index), "node-runtime.js"), "utf8")).toBe(
      "export {};\n",
    );
});

it("removes the whole approved backlog in one upgrade apply", async () => {
  const f = await runtimeHome("linux", 30);
  const options = { ...f, processCommands: async () => "" };
  const plan = await planNodeRuntimeRetention(options);
  expect(plan.candidates).toHaveLength(27);
  expect(await applyNodeRuntimeRetention(plan, options)).toBe(27);
  expect(await planNodeRuntimeRetention(options)).toMatchObject({
    disposition: "current",
    candidates: [],
  });
});

it("does not accept a reused PID or unknown process birth as proof for a current launcher", async () => {
  const f = await runtimeHome("linux");
  const directory = resolve(f.root, name(2), ".processes");
  await mkdir(directory);
  await writeFile(
    resolve(directory, `${process.pid}.json`),
    JSON.stringify({
      schemaVersion: 1,
      processId: process.pid,
      processIdentity: `proc_test_v1:sha256:${"a".repeat(64)}`,
      runtimeDirectory: name(2),
    }),
  );
  const options = {
    ...f,
    processCommands: async () =>
      `${process.pid} /node ${resolve(f.root, "current/node-runtime.js")}`,
  };
  expect(
    await planNodeRuntimeRetention({
      ...options,
      observeProcess: () => ({
        status: "present",
        identity: `proc_test_v1:sha256:${"b".repeat(64)}`,
      }),
    }),
  ).toMatchObject({ disposition: "deferred", candidates: [] });
  expect(
    await planNodeRuntimeRetention({ ...options, observeProcess: () => ({ status: "unknown" }) }),
  ).toMatchObject({ disposition: "deferred", candidates: [] });
});

for (const platform of ["darwin", "linux"] as const) {
  it(`keeps the runtime a running replica coordinator is bound to after current moves on ${platform} (ADR-0573)`, async () => {
    const f = await runtimeHome(platform);
    const identity = `proc_test_v1:sha256:${"c".repeat(64)}`;
    // The coordinator started through `current` while it named name(2); `current` then moved.
    const bindings = resolve(f.root, name(2), ".processes");
    await mkdir(bindings);
    await writeFile(
      resolve(bindings, `${process.pid}.json`),
      JSON.stringify({
        schemaVersion: 1,
        processId: process.pid,
        processIdentity: identity,
        runtimeDirectory: name(2),
      }),
    );
    // Writing the binding must not make name(2) one of the recent runtimes retention keeps anyway.
    await utimes(resolve(f.root, name(2)), new Date(2000), new Date(2000));
    await pointCurrentNodeRuntime({ ...f, runtimeDirectory: name(9) });
    const options = {
      ...f,
      processCommands: async () =>
        `${process.pid} /node ${resolve(f.root, "current/node-runtime.js")} repository-replica reconcile --watch --config /state/repository-replica-coordinator.json`,
      observeProcess: () => ({ status: "present" as const, identity }),
    };
    // Once the coordinator has exited, its binding no longer protects the old runtime.
    const released = await planNodeRuntimeRetention({
      ...f,
      processCommands: async () => "",
      observeProcess: () => ({ status: "absent" as const }),
    });
    expect(released.candidates.map((item) => item.name)).toContain(name(2));
    const plan = await planNodeRuntimeRetention(options);
    expect(plan.candidates.map((item) => item.name)).not.toContain(name(2));
    await applyNodeRuntimeRetention(plan, options);
    expect(await readFile(resolve(f.root, name(2), "node-runtime.js"), "utf8")).toBe(
      "export {};\n",
    );
  });
}

it("ignores a malformed record of a dead process but defers on one of a live process", async () => {
  const f = await runtimeHome("linux");
  const bindings = resolve(f.root, name(2), ".processes");
  await mkdir(bindings);
  await writeFile(
    resolve(bindings, `${process.pid}.json`),
    JSON.stringify({
      schemaVersion: 1,
      processId: process.pid,
      processIdentity: "not-a-birth-identity",
      runtimeDirectory: name(2),
    }),
  );
  await utimes(resolve(f.root, name(2)), new Date(2000), new Date(2000));
  await pointCurrentNodeRuntime({ ...f, runtimeDirectory: name(9) });
  const options = { ...f, processCommands: async () => "" };
  // The process is gone, so its record neither protects the runtime nor blocks retention.
  const dead = await planNodeRuntimeRetention({
    ...options,
    observeProcess: () => ({ status: "absent" as const }),
  });
  expect(dead.disposition).toBe("safe_apply");
  expect(dead.candidates.map((item) => item.name)).toContain(name(2));
  // A live process with an unreadable identity still fails closed.
  expect(
    await planNodeRuntimeRetention({
      ...options,
      observeProcess: () => ({
        status: "present" as const,
        identity: `proc_test_v1:sha256:${"a".repeat(64)}`,
      }),
    }),
  ).toMatchObject({ disposition: "deferred", candidates: [] });
});
