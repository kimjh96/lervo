import { recoverRuntimeRetirement } from "./node-runtime-retirement-journal.js";
import {
  readNodeRuntimeModule,
  inspectNodeRuntimeModule,
  materializeNodeRuntimeModule,
  type NodeRuntimeModule,
} from "./node-fleet-runtime-module.js";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { failNodeFleetApply } from "./node-fleet-apply-contract.js";
import { withNodeRuntimeRetentionLock } from "./node-runtime-retention-lock.js";
import { nodeRuntimesDirectory } from "./node-runtime-pointer.js";
import {
  describeRuntimeDependencies,
  type RuntimeDependencyClosure,
} from "./runtime-dependency-closure.js";
import {
  inspectRuntimeDependencies,
  materializeRuntimeDependencies,
} from "./runtime-dependency-materialization.js";

function safeAbsolute(value: string): boolean {
  return resolve(value) === value && !/[\0\r\n]/u.test(value);
}

function defaultExecutablePath(): string {
  return fileURLToPath(new URL("./node-runtime.js", import.meta.url));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function assertNodeFleetExecutable(path: string): Promise<string> {
  if (!safeAbsolute(path)) {
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime path is invalid.",
    );
  }
  const metadata = await lstat(path).catch((error: unknown) =>
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime is unavailable.",
      error,
    ),
  );
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime must be a real regular file.",
    );
  }
  await access(path, constants.X_OK).catch((error: unknown) =>
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime is not executable.",
      error,
    ),
  );
  return realpath(path);
}

/** The content-addressed payload and launcher the running CLI bundles for this host. */
export interface InstalledNodeLauncher {
  hash: string;
  launcher: string;
  payload: string;
  payloadBytes: Buffer;
  launcherContent: string;
  dependencies: RuntimeDependencyClosure;
  runtimeModule: NodeRuntimeModule;
}

export async function describeInstalledNodeLauncher(
  homeDirectory?: string,
): Promise<InstalledNodeLauncher> {
  const bytes = await readFile(defaultExecutablePath());
  const runtimeModule = await readNodeRuntimeModule(dirname(defaultExecutablePath()));
  const dependencies = await describeRuntimeDependencies(defaultExecutablePath());
  const hexadecimal = createHash("sha256")
    .update(bytes)
    .update(runtimeModule.hash)
    .update(dependencies.hash)
    .digest("hex");
  const directory = resolve(nodeRuntimesDirectory(homeDirectory), hexadecimal.slice(0, 16));
  const payload = resolve(directory, "node-runtime.js");
  return {
    hash: `sha256:${hexadecimal}`,
    launcher: resolve(directory, `lervo-node-launcher-${hexadecimal.slice(0, 12)}`),
    payload,
    payloadBytes: bytes,
    dependencies,
    runtimeModule,
    launcherContent: `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(payload)} "$@"\n`,
  };
}

export async function materializeInstalledNodeLauncher(homeDirectory?: string): Promise<string> {
  return withNodeRuntimeRetentionLock(
    resolve(nodeRuntimesDirectory(homeDirectory), ".retention.lock"),
    async () => {
      await recoverRuntimeRetirement(nodeRuntimesDirectory(homeDirectory));
      return installNodeLauncher(homeDirectory);
    },
  );
}

async function installNodeLauncher(homeDirectory?: string): Promise<string> {
  const source = defaultExecutablePath();
  const sourceInfo = await lstat(source).catch((error: unknown) =>
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime payload is unavailable.",
      error,
    ),
  );
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size < 1) {
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed Node runtime payload is unsafe.",
    );
  }
  const { payload, payloadBytes, launcher, launcherContent, dependencies, runtimeModule } =
    await describeInstalledNodeLauncher(homeDirectory);
  await mkdir(dirname(payload), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(payload));
  if (!directory.isDirectory() || directory.isSymbolicLink())
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed runtime directory is unsafe.",
    );
  for (const [path, content, mode] of [
    [payload, payloadBytes, 0o600],
    [launcher, launcherContent, 0o700],
  ] as const) {
    try {
      await writeFile(path, content, { flag: "wx", mode });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(path);
      const expected = typeof content === "string" ? Buffer.from(content) : content;
      if (!existing.equals(expected)) {
        failNodeFleetApply(
          "node_fleet_executable_invalid",
          "An installed runtime payload path contains different bytes.",
        );
      }
    }
    await chmod(path, mode);
  }
  await materializeNodeRuntimeModule(dirname(payload), runtimeModule);
  await materializeRuntimeDependencies(dirname(payload), dependencies);
  return assertNodeFleetExecutable(launcher);
}

export async function inspectInstalledNodeDependencies(
  launcher: InstalledNodeLauncher,
): Promise<"current" | "missing" | "conflict"> {
  const moduleStatus = await inspectNodeRuntimeModule(
    dirname(launcher.payload),
    launcher.runtimeModule,
  );
  const dependencyStatus = await inspectRuntimeDependencies(
    dirname(launcher.payload),
    launcher.dependencies,
  );
  if (moduleStatus === "conflict" || dependencyStatus === "conflict") return "conflict";
  return moduleStatus === "missing" || dependencyStatus === "missing" ? "missing" : "current";
}
