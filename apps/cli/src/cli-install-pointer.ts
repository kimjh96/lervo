import { randomUUID } from "node:crypto";
import { lstat, mkdir, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { nodeRuntimesDirectory } from "./node-runtime-pointer.js";

/**
 * ADR-0487: every host keeps one `current` pointer to the installed CLI package that last ran
 * `lervo upgrade`, beside the Node runtimes of ADR-0483. Node configurations name
 * `<cli>/current/dist/bin.js`, so removing an old CLI install never breaks a Node at restart.
 * Unlike a Node runtime, the CLI package keeps its own dependencies, so the pointer is an absolute
 * link to the install directory instead of a copied payload.
 */
export const CLI_CURRENT_POINTER = "current";
export const CLI_BIN_RELATIVE_PATH = "dist/bin.js";
/** The files a CLI package publishes under `dist/`, which Node configurations may name. */
export const CLI_DIST_FILES = ["bin.js", "node-runtime.js", "terminal-hook.js"] as const;

export function cliInstallsDirectory(
  homeDirectory?: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return resolve(dirname(nodeRuntimesDirectory(homeDirectory, platform)), "cli");
}

/** The stable pointer directory that stands for the installed CLI package root. */
export function currentCliInstallRoot(homeDirectory?: string, platform?: NodeJS.Platform): string {
  return resolve(cliInstallsDirectory(homeDirectory, platform), CLI_CURRENT_POINTER);
}

/** The stable CLI executable Node configurations name. */
export function currentCliExecutable(homeDirectory?: string, platform?: NodeJS.Platform): string {
  return resolve(currentCliInstallRoot(homeDirectory, platform), CLI_BIN_RELATIVE_PATH);
}

async function isRegularFile(path: string): Promise<boolean> {
  const metadata = await lstat(path).catch(() => null);
  return metadata !== null && metadata.isFile() && !metadata.isSymbolicLink();
}

/**
 * The physical package root of the running CLI, or null when this process does not run from a
 * built `dist/bin.js`, as in source-level tests.
 */
export async function runningCliInstallRoot(
  bin: URL = new URL("./bin.js", import.meta.url),
): Promise<string | null> {
  const path = fileURLToPath(bin);
  if (!(await isRegularFile(path))) return null;
  return realpath(dirname(dirname(path))).catch(() => null);
}

/** The install root `current` names, or null when the pointer is absent or not absolute. */
export async function readCurrentCliInstall(
  homeDirectory?: string,
  platform?: NodeJS.Platform,
): Promise<string | null> {
  try {
    const target = await readlink(currentCliInstallRoot(homeDirectory, platform));
    return isAbsolute(target) ? target : null;
  } catch {
    return null;
  }
}

export type CliInstallPointerChange = "created" | "updated" | "unchanged";

/**
 * Points `current` at one installed CLI package. The package must hold a regular `dist/bin.js`,
 * and the swap is one rename, so a Node that starts meanwhile sees the old or the new install.
 */
export async function pointCurrentCliInstall(input: {
  installRoot: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}): Promise<CliInstallPointerChange> {
  if (!isAbsolute(input.installRoot) || /[\0\r\n]/u.test(input.installRoot))
    throw new Error("The CLI install root must be a safe absolute path.");
  if (!(await isRegularFile(resolve(input.installRoot, CLI_BIN_RELATIVE_PATH))))
    throw new Error("The CLI install to activate has no regular dist/bin.js.");
  const previous = await readCurrentCliInstall(input.homeDirectory, input.platform);
  if (previous === input.installRoot) return "unchanged";
  const directory = cliInstallsDirectory(input.homeDirectory, input.platform);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = resolve(directory, `.${CLI_CURRENT_POINTER}-${randomUUID()}`);
  try {
    await symlink(input.installRoot, temporary);
    await rename(temporary, resolve(directory, CLI_CURRENT_POINTER));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return previous === null ? "created" : "updated";
}
