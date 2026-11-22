import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";

import { createClaudeHostedSessionAdapter } from "@lervo/adapter-claude";
import { createCodexHostedSessionAdapter } from "@lervo/adapter-codex";
import type { HostedSessionAdapter } from "@lervo/adapter-contract";

import { CommandFailure } from "./command-error-output.js";

interface HostedProvider {
  /** The executable name on `PATH`. */
  readonly executable: string;
  readonly create: (executable: string) => HostedSessionAdapter;
}

/**
 * The admitted hosted-session adapters by provider. A new provider adds one entry here and its
 * adapter package; callers read the adapter's capabilities, never the provider name.
 */
const hostedProviders: ReadonlyMap<string, HostedProvider> = new Map([
  ["claude", { executable: "claude", create: createClaudeHostedSessionAdapter }],
  ["codex", { executable: "codex", create: createCodexHostedSessionAdapter }],
]);

export function hostedProviderNames(): string[] {
  return [...hostedProviders.keys()];
}

/** The first executable file named `name` on `PATH`, or null. */
async function findOnPath(name: string, environment: NodeJS.ProcessEnv): Promise<string | null> {
  const path = environment.PATH ?? environment.Path ?? "";
  for (const directory of path.split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = resolve(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return null;
}

/**
 * The adapter for `provider`, bound to the provider CLI's absolute path, so the session host
 * runs the same binary whatever its own `PATH` is.
 */
export async function resolveHostedSessionAdapter(
  provider: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<HostedSessionAdapter> {
  const entry = hostedProviders.get(provider);
  if (entry === undefined)
    throw new CommandFailure(
      "provider_unknown",
      `No hosted-session adapter exists for ${provider}.`,
      {
        providers: hostedProviderNames(),
      },
    );
  const executable = await findOnPath(entry.executable, environment);
  if (executable === null)
    throw new CommandFailure(
      "provider_cli_unavailable",
      `The ${entry.executable} CLI was not found on PATH.`,
      { provider },
    );
  return entry.create(executable);
}
