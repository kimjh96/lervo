import { assertRealRuntimeRoot } from "./node-runtime-root-guard.js";
import { withNodeRuntimeRetentionLock } from "./node-runtime-retention-lock.js";
import { randomUUID } from "node:crypto";
import { lstat, readlink, rename, rm, symlink } from "node:fs/promises";
import { nodeRuntimesDirectory } from "@lervo/runtime-security";
export { nodeRuntimesDirectory } from "@lervo/runtime-security";
import { basename, dirname, resolve } from "node:path";

/**
 * ADR-0483: every host keeps one `current` pointer beside its content-addressed Node runtimes.
 * It is a relative symbolic link to the activated `<hash16>` directory, replaced atomically by
 * rename, so `<runtimes>/current/node-runtime.js` always names a whole installed payload. The
 * replica coordinator's peer command and the local replica service run through it, so a deploy
 * never leaves a pinned runtime path behind.
 */
export const NODE_RUNTIME_CURRENT_POINTER = "current";
export const NODE_RUNTIME_PAYLOAD = "node-runtime.js";
const RUNTIME_DIRECTORY = /^[a-f0-9]{16}$/u;

/** The stable payload path that always resolves to the activated runtime. */
export function currentNodeRuntimePayload(
  homeDirectory?: string,
  platform?: NodeJS.Platform,
): string {
  return resolve(
    nodeRuntimesDirectory(homeDirectory, platform),
    NODE_RUNTIME_CURRENT_POINTER,
    NODE_RUNTIME_PAYLOAD,
  );
}

/** The runtime directory name `current` names, or null when the pointer is absent or foreign. */
export async function readCurrentNodeRuntime(
  homeDirectory?: string,
  platform?: NodeJS.Platform,
): Promise<string | null> {
  try {
    const target = await readlink(
      resolve(nodeRuntimesDirectory(homeDirectory, platform), NODE_RUNTIME_CURRENT_POINTER),
    );
    return RUNTIME_DIRECTORY.test(target) ? target : null;
  } catch {
    return null;
  }
}

/** The `<hash16>` runtime directory a launcher or payload lies in, or null outside the runtimes. */
export function nodeRuntimeDirectoryName(
  executable: string,
  homeDirectory?: string,
  platform?: NodeJS.Platform,
): string | null {
  const directory = dirname(resolve(executable));
  const name = basename(directory);
  return dirname(directory) === nodeRuntimesDirectory(homeDirectory, platform) &&
    RUNTIME_DIRECTORY.test(name)
    ? name
    : null;
}

export type NodeRuntimePointerChange = "created" | "updated" | "unchanged";

/**
 * Points `current` at one installed runtime directory. The directory must hold a regular
 * payload, and the swap is a single rename, so readers see the old or the new runtime only.
 */
export async function pointCurrentNodeRuntime(input: {
  runtimeDirectory: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}): Promise<NodeRuntimePointerChange> {
  return withNodeRuntimeRetentionLock(
    resolve(nodeRuntimesDirectory(input.homeDirectory, input.platform), ".retention.lock"),
    () => swapCurrentNodeRuntime(input),
  );
}

async function swapCurrentNodeRuntime(input: {
  runtimeDirectory: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}): Promise<NodeRuntimePointerChange> {
  if (!RUNTIME_DIRECTORY.test(input.runtimeDirectory))
    throw new Error("The Node runtime directory name is invalid.");
  const runtimes = nodeRuntimesDirectory(input.homeDirectory, input.platform);
  await assertRealRuntimeRoot(runtimes, input.platform);
  const directory = await lstat(resolve(runtimes, input.runtimeDirectory));
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error("The Node runtime directory is unsafe.");
  const payload = await lstat(resolve(runtimes, input.runtimeDirectory, NODE_RUNTIME_PAYLOAD));
  if (!payload.isFile() || payload.isSymbolicLink())
    throw new Error("The Node runtime payload to activate is not a regular file.");
  const previous = await readCurrentNodeRuntime(input.homeDirectory, input.platform);
  if (previous === input.runtimeDirectory) return "unchanged";
  const temporary = resolve(runtimes, `.${NODE_RUNTIME_CURRENT_POINTER}-${randomUUID()}`);
  try {
    await symlink(input.runtimeDirectory, temporary);
    await rename(temporary, resolve(runtimes, NODE_RUNTIME_CURRENT_POINTER));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return previous === null ? "created" : "updated";
}

/** Points `current` at the runtime an activated launcher belongs to; foreign paths are skipped. */
export async function pointCurrentNodeRuntimeAt(
  executable: string,
  homeDirectory?: string,
): Promise<NodeRuntimePointerChange | "not_managed"> {
  const name = nodeRuntimeDirectoryName(executable, homeDirectory);
  if (name === null) return "not_managed";
  return pointCurrentNodeRuntime({
    runtimeDirectory: name,
    ...(homeDirectory === undefined ? {} : { homeDirectory }),
  });
}
