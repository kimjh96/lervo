import { randomUUID } from "node:crypto";
import { mkdir, readFile, readlink, realpath, rename, rm, symlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { CommandFailure } from "./command-error-output.js";
import { readActivationJournal, readHostLinks } from "./host-cli-activation.js";
import { readFollowState } from "./host-follow-state.js";
import { isRepositoryCoordinate } from "./host-release-source.js";
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
 * ADR-0575: the follower service runs `<cli>/host-follow-runtime/dist/bin.js`, so a release
 * changes its definition only when the renderer changes, as ADR-0577 did; `--status` then reports
 * `definition_outdated` until the owner reinstalls the service. Only the follower moves this link, and only to the package the
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

/**
 * ADR-0575: the repository this host last installed a release from. Every ADR-0571 release record
 * names it (since v0.24.0), so the newest one is the default coordinate; the follower state, which
 * remembers the coordinate it last checked, covers a journal whose release records all rotated
 * out. Null when the host never installed through `lervo host upgrade`.
 */
export async function recordedInstallRepository(layout: HostUpgradeLayout): Promise<string | null> {
  const fromJournal = (await readActivationJournal(layout))
    .map((record) => record.release?.repository)
    .filter((repository): repository is string => repository !== undefined)
    .at(-1);
  const repository = fromJournal ?? (await readFollowState(layout)).repository;
  return repository !== null && isRepositoryCoordinate(repository) ? repository : null;
}

/** Asked once: after one `--from-release` install or service install names it, the host keeps it. */
export const REPOSITORY_UNKNOWN_MESSAGE =
  "This host never installed a release through lervo host upgrade, so the repository to follow is unknown; pass --repository <owner/name> once.";

export function repositoryUnknown(): CommandFailure {
  return new CommandFailure("host_follow_repository_unknown", REPOSITORY_UNKNOWN_MESSAGE);
}
