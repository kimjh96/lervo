import { randomUUID } from "node:crypto";
import { mkdir, readFile, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { readHostLinks } from "./host-cli-activation.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";

/** The CLI the host's `lervo` link runs now. */
export interface ActiveCli {
  /** The link target, or null when the link does not exist. */
  target: string | null;
  /** The physical package root of that target, or null when it cannot be resolved. */
  packageRoot: string | null;
  version: string | null;
}

const versionPattern = /^\d+\.\d+\.\d+$/u;

export async function readActiveCli(layout: HostUpgradeLayout): Promise<ActiveCli> {
  const target = (await readHostLinks(layout)).get("lervo") ?? null;
  if (target === null) return { target, packageRoot: null, version: null };
  // The link names `<package>/dist/bin.js` (ADR-0571 HOST_CLI_LINKS).
  const packageRoot = await realpath(resolve(dirname(target), "..")).catch(() => null);
  if (packageRoot === null) return { target, packageRoot, version: null };
  const version = await readFile(resolve(packageRoot, "package.json"), "utf8").then(
    (contents) => (JSON.parse(contents) as { version?: unknown }).version,
    () => null,
  );
  return {
    target,
    packageRoot,
    version: typeof version === "string" && versionPattern.test(version) ? version : null,
  };
}

/**
 * ADR-0575: the follower service runs `<cli>/host-follow-runtime/dist/bin.js`, so its definition
 * never changes across releases. Only the follower moves this link, and only to the package the
 * `lervo` link already runs, right before it exits for the service manager to restart it there.
 * The swap is one rename, so a start meanwhile sees the old or the new package.
 */
export async function pointFollowRuntime(
  layout: HostUpgradeLayout,
  packageRoot: string,
): Promise<boolean> {
  const pointer = layout.follow.runtimePointer;
  if ((await readlink(pointer).catch(() => null)) === packageRoot) return false;
  await mkdir(dirname(pointer), { recursive: true, mode: 0o700 });
  const temporary = `${pointer}.${randomUUID()}`;
  try {
    await symlink(packageRoot, temporary);
    await rename(temporary, pointer);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return true;
}
