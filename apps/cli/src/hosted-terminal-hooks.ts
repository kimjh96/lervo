// Every hosted session is a Lervo session (ADR-0632, S2a; Lervo ADE sessions, "Hosted launches").
// Project hooks usually carry Lervo's terminal hooks; the hosted launch adds them for the events
// no settings file the session merges covers, and only for those, so no event runs Lervo twice.
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { HostedSessionAdapter, HostedTerminalHooks } from "@lervo/adapter-contract";
import {
  missingTerminalHookEvents,
  PROVIDERS,
  providerHookSettingsFiles,
  TERMINAL_HOOK_RUNTIME_PATH,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import { hostTerminalLauncherPath } from "./terminal-runtime.js";

/** A settings file larger than this is not a settings file Lervo reads. */
const MAXIMUM_SETTINGS_BYTES = 1024 * 1024;

/** The terminal hooks of a hosted launch, and whether they run the host launcher or the CLI. */
export interface HostedTerminalHookPlan extends HostedTerminalHooks {
  readonly via: "launcher" | "cli";
}

/** Whether `path` names a file, following links as the provider and Node do. */
const isFile = (path: string) =>
  stat(path).then(
    (found) => found.isFile(),
    () => false,
  );

/** The file's text, or null when it is missing, not a file, or too large to be settings. */
async function settingsText(path: string): Promise<string | null> {
  try {
    const found = await stat(path);
    if (!found.isFile() || found.size > MAXIMUM_SETTINGS_BYTES) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function terminalProvider(provider: string): TerminalIntegrationProvider | null {
  return (PROVIDERS as readonly string[]).includes(provider)
    ? (provider as TerminalIntegrationProvider)
    : null;
}

/**
 * The terminal hooks a hosted session in `worktree` needs: a handler for each event no merged
 * settings file covers with Lervo's hook, or undefined when every event is covered or the
 * adapter takes no hooks. They run the host launcher beside the runtime store, the path every
 * Lervo session takes; a host whose install predates that launcher runs the CLI's terminal hook
 * instead, and the plan says which.
 */
export async function hostedTerminalHooks(
  adapter: HostedSessionAdapter,
  worktree: string,
  options: { launcher?: string; environment?: NodeJS.ProcessEnv; home?: string } = {},
): Promise<HostedTerminalHookPlan | undefined> {
  const provider = terminalProvider(adapter.provider);
  if (!adapter.capabilities.hooks || provider === null) return undefined;
  const files = providerHookSettingsFiles(provider, worktree, options.environment, options.home);
  const settings = (await Promise.all(files.map(settingsText))).filter(
    (text): text is string => text !== null,
  );
  const repositoryLauncher = await isFile(resolve(worktree, TERMINAL_HOOK_RUNTIME_PATH));
  const missing = missingTerminalHookEvents(provider, settings, repositoryLauncher);
  if (missing.length === 0) return undefined;
  const events = missing.map((event) => ({
    name: event.name as HostedTerminalHooks["events"][number]["name"],
    ...(event.matcher === undefined ? {} : { matcher: event.matcher }),
  }));
  const launcher = options.launcher ?? hostTerminalLauncherPath();
  return (await isFile(launcher))
    ? {
        command: `node ${JSON.stringify(launcher)} --provider ${provider} --contract 2`,
        events,
        via: "launcher",
      }
    : { command: `lervo terminal hook --provider ${provider} --contract 2`, events, via: "cli" };
}
