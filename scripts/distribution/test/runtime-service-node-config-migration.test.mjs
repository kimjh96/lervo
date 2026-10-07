import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  SQLiteNodeWorkAdmission,
  nodeWorkAdmissionDatabasePath,
  nodeWorkAdmissionScope,
} from "../../../packages/node-work-admission/src/index.js";
import { manageRuntimeService } from "../manage-runtime-service.mjs";
import { renderRuntimeService } from "../render-runtime-service.mjs";

const roots = [];
const instance = "nfi_0123456789abcdef01234567";
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function render(root, name, executable, config) {
  await writeFile(executable, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  const definition = resolve(root, name);
  await renderRuntimeService([
    "--manager",
    "systemd",
    "--runtime",
    "node",
    "--instance",
    instance,
    "--executable",
    executable,
    "--config",
    config,
    "--output",
    definition,
  ]);
  return definition;
}

/**
 * One running Node bound to its pinned configuration. The fake systemd ends the Node's admission
 * session on stop and starts a replacement that registers the digest of the file it reads.
 */
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-service-config-migration-"));
  roots.push(root);
  const install = resolve(root, "installs", "cli-0.21.0");
  await mkdir(resolve(install, "dist"), { recursive: true });
  await writeFile(resolve(install, "dist", "bin.js"), "#!/usr/bin/env node\n", { mode: 0o755 });
  const pointer = resolve(root, "share", "lervo", "runtimes", "cli", "current");
  await mkdir(resolve(pointer, ".."), { recursive: true });
  await symlink(install, pointer);
  const removed = resolve(root, "lervo-cli/convergence-0.18.0/node_modules/@lervo/cli/dist/bin.js");
  const config = resolve(root, "node.json");
  const before = {
    repositoryRoot: root,
    requestedRuntimes: [{ executable: "/usr/bin/node", arguments: [removed, "knowledge"] }],
  };
  const after = structuredClone(before);
  after.requestedRuntimes[0].arguments[0] = `${pointer}/dist/bin.js`;
  const original = `${JSON.stringify(before, null, 2)}\n`;
  const migrated = `${JSON.stringify(after, null, 2)}\n`;
  await writeFile(config, original, { mode: 0o600 });
  const previous = await render(root, "v1.service", resolve(root, "lervo-node-v1"), config);
  const replacement = await render(root, "v2.service", resolve(root, "lervo-node-v2"), config);

  const path = nodeWorkAdmissionDatabasePath(root);
  const scope = nodeWorkAdmissionScope(config);
  const alive = new Set([process.pid]);
  const isAlive = (pid) => alive.has(pid);
  const node = await SQLiteNodeWorkAdmission.open({ path, isAlive });
  let nextPid = 4000;
  let session = null;
  const startNode = async () => {
    nextPid += 1;
    alive.add(nextPid);
    session = node.registerSession({
      scope,
      configDigest: digest(await readFile(config)),
      ownerPid: nextPid,
    });
  };
  const active = new Set();
  const enabled = new Set();
  const calls = [];
  const run = async (command, args) => {
    calls.push(args.slice(1).join(" "));
    if (command !== "systemctl" || args[0] !== "--user") return { exitCode: null };
    if (args[1] === "daemon-reload") return { exitCode: 0 };
    if (args[1] === "is-enabled") return { exitCode: enabled.has(args[2]) ? 0 : 1 };
    if (args[1] === "is-active") return { exitCode: active.has(args[2]) ? 0 : 3 };
    if (args[1] === "stop") {
      active.delete(args[2]);
      if (session !== null) alive.delete(session.ownerPid);
      session = null;
      return { exitCode: 0 };
    }
    if (args[1] === "start" || (args[1] === "enable" && args[2] === "--now")) {
      if (args[1] === "enable") enabled.add(args.at(-1));
      active.add(args.at(-1));
      await startNode();
      return { exitCode: 0 };
    }
    return { exitCode: 1 };
  };
  const options = {
    platform: "linux",
    homeDirectory: root,
    runCommand: run,
    wait: async () => {},
    openNodeWorkAdmission: async () => ({
      store: await SQLiteNodeWorkAdmission.open({ path, isAlive }),
      scope,
    }),
  };
  const args = (action, definition, previousDefinition, extra = []) => [
    "--action",
    action,
    "--manager",
    "systemd",
    "--runtime",
    "node",
    "--instance",
    instance,
    "--definition",
    definition,
    ...(previousDefinition === undefined ? [] : ["--previous-definition", previousDefinition]),
    "--executable",
    resolve(root, definition === previous ? "lervo-node-v1" : "lervo-node-v2"),
    "--config",
    config,
    ...extra,
    "--write",
  ];
  await manageRuntimeService(args("install", previous), options);
  return {
    root,
    config,
    original,
    migrated,
    previous,
    replacement,
    node,
    scope,
    options,
    args,
    calls,
    session: () => session,
  };
}

it("upgrades a Node whose configuration an older CLI migrated in place while it ran", async () => {
  const f = await fixture();
  try {
    expect(f.session()).not.toBeNull();
    // ADR-0488 as deployed: back up, then rewrite the file under the running Node.
    await writeFile(`${f.config}.pre-adr-0488-${digest(f.original).slice(7, 19)}`, f.original, {
      mode: 0o600,
    });
    await writeFile(f.config, f.migrated, { mode: 0o600 });

    await expect(
      manageRuntimeService(f.args("upgrade", f.replacement, f.previous), f.options),
    ).resolves.toMatchObject({ change: "upgraded", active: true });

    expect(await readFile(f.config, "utf8")).toBe(f.migrated);
    // The replacement registered the migrated digest inside the freeze, so the binding moved.
    expect(f.session()).not.toBeNull();
  } finally {
    f.node.close();
  }
});

it("names the digest mismatch when no retained predecessor explains the change", async () => {
  const f = await fixture();
  try {
    await writeFile(f.config, f.migrated, { mode: 0o600 });
    await expect(
      manageRuntimeService(f.args("upgrade", f.replacement, f.previous), f.options),
    ).rejects.toMatchObject({
      code: "service_upgrade_config_mismatch",
      message: expect.stringContaining("different configuration digest"),
    });
    expect(f.calls.some((call) => call.startsWith("stop"))).toBe(false);
  } finally {
    f.node.close();
  }
});

it("restarts an unchanged definition to apply a configuration migration under the fence", async () => {
  const f = await fixture();
  try {
    const candidate = resolve(f.root, "candidate.json");
    await writeFile(candidate, f.migrated, { mode: 0o600 });
    const sessionBefore = f.session();

    await expect(
      manageRuntimeService(
        f.args("upgrade", f.previous, f.previous, ["--configuration-source", candidate]),
        f.options,
      ),
    ).resolves.toMatchObject({ change: "upgraded", active: true });

    expect(await readFile(f.config, "utf8")).toBe(f.migrated);
    expect(f.session()).not.toBeNull();
    expect(f.session().ownerPid).not.toBe(sessionBefore.ownerPid);
  } finally {
    f.node.close();
  }
});

it("still refuses an unchanged definition without a configuration transition", async () => {
  const f = await fixture();
  try {
    await expect(
      manageRuntimeService(f.args("upgrade", f.previous, f.previous), f.options),
    ).rejects.toMatchObject({ code: "service_state_conflict" });
  } finally {
    f.node.close();
  }
});
