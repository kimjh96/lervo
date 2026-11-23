// Session-scoped settings files for hosted sessions (Lervo ADE sessions, "Hosted launches"). Each
// holds Lervo's hook handler for one session, lives in the user state directory with mode 0600,
// and leaves the user's own settings files unchanged.
import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { HostedSessionAdapter, HostedSessionHooks } from "@lervo/adapter-contract";
import { writePrivateTextFile } from "@lervo/repository-knowledge-runtime";
import { defaultRepositoryRegistryPath } from "@lervo/repository-registry";

/** The directory of the host's settings files, next to the repository registry. */
export function hostedSessionSettingsDirectory(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(dirname(defaultRepositoryRegistryPath(environment)), "hosted-settings");
}

/**
 * The hook handler for an adapter that declares `hooks`, or undefined. The command finds `lervo`
 * on the `PATH` the session host passes on, so it survives an upgrade of the CLI.
 */
export function hostedSessionHooks(
  adapter: HostedSessionAdapter,
  sessionId: string,
  environment: NodeJS.ProcessEnv = process.env,
): HostedSessionHooks | undefined {
  if (!adapter.capabilities.hooks) return undefined;
  return {
    settingsPath: resolve(hostedSessionSettingsDirectory(environment), `${sessionId}.json`),
    command: `lervo workspace hook --provider ${adapter.provider}`,
  };
}

/** The digest the launch descriptor record keeps for the settings file. */
export function settingsFileDigest(file: { readonly content: string }): string {
  return `sha256:${createHash("sha256").update(file.content).digest("hex")}`;
}

export async function writeHostedSessionSettings(file: {
  readonly path: string;
  readonly content: string;
}): Promise<void> {
  await writePrivateTextFile(file.path, file.content);
}

/** Removes the settings files of sessions that no kept launch record names. */
export async function pruneHostedSessionSettings(
  directory: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  for (const name of names)
    if (name.endsWith(".json") && !keep.has(name.slice(0, -".json".length)))
      await rm(resolve(directory, name), { force: true });
}
