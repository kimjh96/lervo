import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
const nodeInstance = "nfi_0123456789abcdef01234567";
const plistName = "com.lervo.node.0123456789abcdef01234567.plist";
// Longer than the former six-probe stop window: a real Node drains work after SIGTERM.
const terminatingObservations = 12;

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function definition(root, name, executable, config) {
  await writeFile(executable, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  const output = resolve(root, name);
  await renderRuntimeService([
    "--manager",
    "launchd",
    "--runtime",
    "node",
    "--instance",
    nodeInstance,
    "--executable",
    executable,
    "--config",
    config,
    "--output",
    output,
  ]);
  return output;
}

async function launchdNode() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-launchd-upgrade-"));
  roots.push(root);
  const config = resolve(root, "node.json");
  const source = JSON.stringify({ repositoryRoot: root });
  await writeFile(config, source, { mode: 0o600 });
  const previousExecutable = resolve(root, "lervo-node-launcher-old");
  const replacementExecutable = resolve(root, "lervo-node-launcher-new");
  const previous = await definition(root, "previous.plist", previousExecutable, config);
  const replacement = await definition(root, "replacement.plist", replacementExecutable, config);
  const admission = await SQLiteNodeWorkAdmission.open({
    path: nodeWorkAdmissionDatabasePath(root),
  });
  const scope = nodeWorkAdmissionScope(config);
  const configDigest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  const target = resolve(root, "Library/LaunchAgents", plistName);
  const replacementBytes = await readFile(replacement, "utf8");
  return {
    root,
    config,
    previous,
    replacement,
    admission,
    target,
    replacementBytes,
    upgradeArgs: [
      "--action",
      "upgrade",
      "--manager",
      "launchd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--definition",
      replacement,
      "--previous-definition",
      previous,
      "--executable",
      replacementExecutable,
      "--config",
      config,
      "--write",
    ],
    installArgs: [
      "--action",
      "install",
      "--manager",
      "launchd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--definition",
      previous,
      "--executable",
      previousExecutable,
      "--config",
      config,
      "--write",
    ],
    register: () => admission.registerSession({ scope, configDigest, ownerPid: process.pid }),
  };
}

/**
 * Models launchd as observed on macOS: `bootout` returns at once while the job stays
 * printable during SIGTERM handling, and `bootstrap` fails with EIO until the job is gone.
 */
function asyncBootoutLaunchd(node, { rejectBootstrapOf } = {}) {
  const state = { loaded: false, terminating: 0, session: null, bootstraps: 0 };
  const exitProcess = () => {
    if (state.session !== null) node.admission.unregisterSession(state.session);
    state.session = null;
    state.loaded = false;
  };
  state.run = async (command, args) => {
    if (command !== "launchctl") return { exitCode: null };
    if (args[0] === "print") {
      if (state.terminating > 0) {
        state.terminating -= 1;
        if (state.terminating === 0) exitProcess();
      }
      return { exitCode: state.loaded ? 0 : 113 };
    }
    if (args[0] === "enable") return { exitCode: 0 };
    if (args[0] === "bootstrap") {
      if (state.loaded) return { exitCode: 5 };
      state.bootstraps += 1;
      const bytes = await readFile(node.target, "utf8");
      if (rejectBootstrapOf !== undefined && bytes === rejectBootstrapOf) return { exitCode: 5 };
      state.loaded = true;
      state.session = node.register();
      return { exitCode: 0 };
    }
    if (args[0] === "bootout") {
      if (!state.loaded) return { exitCode: 3 };
      state.terminating = terminatingObservations;
      return { exitCode: 0 };
    }
    return { exitCode: 1 };
  };
  return state;
}

function launchdOptions(node, launchd) {
  return {
    platform: "darwin",
    uid: 501,
    homeDirectory: node.root,
    runCommand: launchd.run,
    wait: async () => {},
  };
}

it("upgrades a launchd Node whose predecessor outlives the asynchronous bootout", async () => {
  const node = await launchdNode();
  const launchd = asyncBootoutLaunchd(node);
  const options = launchdOptions(node, launchd);
  try {
    await manageRuntimeService(node.installArgs, options);
    await expect(manageRuntimeService(node.upgradeArgs, options)).resolves.toMatchObject({
      change: "upgraded",
      active: true,
    });
    expect(await readFile(node.target, "utf8")).toBe(node.replacementBytes);
    expect(launchd.bootstraps).toBe(2);
    const claim = node.admission.tryAcquireWork(launchd.session);
    expect(claim).not.toBeNull();
    node.admission.releaseWork(claim);
  } finally {
    node.admission.close();
  }
});

it("re-applies an upgrade after an interrupted attempt left the launchd Node stopped", async () => {
  const node = await launchdNode();
  const launchd = asyncBootoutLaunchd(node);
  const options = launchdOptions(node, launchd);
  try {
    await manageRuntimeService(node.installArgs, options);
    // The interrupted attempt booted the service out and its process exited gracefully.
    await launchd.run("launchctl", ["bootout", `gui/501/${plistName.slice(0, -6)}`]);
    while (launchd.loaded) await launchd.run("launchctl", ["print"]);
    expect(launchd.session).toBeNull();

    await expect(manageRuntimeService(node.upgradeArgs, options)).resolves.toMatchObject({
      change: "upgraded",
      active: true,
    });
    expect(await readFile(node.target, "utf8")).toBe(node.replacementBytes);
    const claim = node.admission.tryAcquireWork(launchd.session);
    expect(claim).not.toBeNull();
    node.admission.releaseWork(claim);
  } finally {
    node.admission.close();
  }
});

it("restores and reloads the launchd predecessor when the replacement cannot start", async () => {
  const node = await launchdNode();
  const launchd = asyncBootoutLaunchd(node, { rejectBootstrapOf: node.replacementBytes });
  const options = launchdOptions(node, launchd);
  const previousBytes = await readFile(node.previous, "utf8");
  try {
    await manageRuntimeService(node.installArgs, options);
    await expect(manageRuntimeService(node.upgradeArgs, options)).rejects.toMatchObject({
      code: "service_upgrade_failed",
    });
    expect(await readFile(node.target, "utf8")).toBe(previousBytes);
    expect(launchd.loaded).toBe(true);
    const claim = node.admission.tryAcquireWork(launchd.session);
    expect(claim).not.toBeNull();
    node.admission.releaseWork(claim);
  } finally {
    node.admission.close();
  }
});
