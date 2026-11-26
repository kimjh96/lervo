// Every hosted session is a Lervo session (ADR-0632, S2a; Lervo ADE sessions, "Hosted launches").
// Project hooks usually carry Lervo's terminal hooks; the hosted launch adds them for the events
// no settings file the session merges covers, and only for those, so no event runs Lervo twice.
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  answersClaims,
  type HostedSessionAdapter,
  type HostedTerminalHookEvent,
  type HostedTerminalHooks,
} from "@lervo/adapter-contract";
import {
  claimHandlerCovered,
  missingTerminalHookEvents,
  PROVIDERS,
  providerHookSettingsFiles,
  TERMINAL_HOOK_RUNTIME_PATH,
  terminalHookEventsRunning,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import { hostTerminalLauncherPath, trustedHostTerminalLauncher } from "./terminal-runtime.js";

/** A settings file larger than this is not a settings file Lervo reads. */
const MAXIMUM_SETTINGS_BYTES = 1024 * 1024;

/** The terminal hooks of a hosted launch, and whether they run the host launcher or the CLI. */
export interface HostedTerminalHookPlan extends HostedTerminalHooks {
  readonly via: "launcher" | "cli";
}

/**
 * A path as one POSIX shell word, which is how the provider runs hook commands, Git Bash on
 * Windows included: single-quoted so nothing in it expands, with forward slashes on Windows.
 */
function shellWord(path: string, platform: NodeJS.Platform): string {
  const portable = platform === "win32" ? path.replaceAll("\\", "/") : path;
  return `'${portable.replaceAll("'", `'"'"'`)}'`;
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
 * What a hosted launch's settings file proves it added: the plan's events whose handlers in the
 * written `settings` run the plan's command, or its claim command for `PreToolUse`. Nothing, when
 * the adapter wrote none of them.
 */
export function writtenTerminalHooks(
  plan: HostedTerminalHookPlan,
  settings: { readonly content: string } | null,
): { events: string[]; via: HostedTerminalHookPlan["via"] } | undefined {
  if (settings === null) return undefined;
  const commands =
    plan.claimCommand === undefined ? [plan.command] : [plan.command, plan.claimCommand];
  const running = new Set(
    commands
      .flatMap((command) => terminalHookEventsRunning(settings.content, command))
      .map((event) => `${event.name}\0${event.matcher ?? ""}`),
  );
  const events = plan.events
    .filter((event) => running.has(`${event.name}\0${event.matcher ?? ""}`))
    .map((event) => event.name);
  return events.length === 0 ? undefined : { events, via: plan.via };
}

/**
 * The terminal hooks a hosted session in `worktree` needs: a handler for each event no merged
 * settings file covers with Lervo's hook, or undefined when every event is covered or the
 * adapter takes no hooks. They run `terminalHookCommandOf`'s command, and the plan says which.
 * With `claims`, the session also claims its writes: the plan adds the claim handler for the
 * adapter's tools when no merged file runs it (Lervo ADE coordination, "Where the handler runs").
 */
export async function hostedTerminalHooks(
  adapter: HostedSessionAdapter,
  worktree: string,
  options: {
    launcher?: string;
    environment?: NodeJS.ProcessEnv;
    home?: string;
    platform?: NodeJS.Platform;
    /** Whether the worktree's conversation claims its paths. */
    claims?: boolean;
  } = {},
): Promise<HostedTerminalHookPlan | undefined> {
  const provider = terminalProvider(adapter.provider);
  if (!adapter.capabilities.hooks || provider === null) return undefined;
  const platform = options.platform ?? process.platform;
  const files = providerHookSettingsFiles(
    provider,
    worktree,
    options.environment,
    options.home,
    platform,
  );
  const settings = (await Promise.all(files.map(settingsText))).filter(
    (text): text is string => text !== null,
  );
  const repositoryLauncher = await isFile(resolve(worktree, TERMINAL_HOOK_RUNTIME_PATH));
  const events: HostedTerminalHookEvent[] = missingTerminalHookEvents(
    provider,
    settings,
    repositoryLauncher,
  ).map((event) => ({
    name: event.name as HostedTerminalHookEvent["name"],
    ...(event.matcher === undefined ? {} : { matcher: event.matcher }),
  }));
  const claims = options.claims === true && answersClaims(adapter) ? adapter.claimTools : null;
  if (claims !== null && !claimHandlerCovered(settings, claims))
    events.push({ name: "PreToolUse", matcher: claims });
  if (events.length === 0) return undefined;
  const { command, via } = await terminalHookCommandOf(provider, options);
  return events.some((event) => event.name === "PreToolUse")
    ? { command, events, via, claimCommand: `${command} --claim` }
    : { command, events, via };
}

/**
 * The command that runs Lervo's terminal hook for `provider` outside a repository's own launcher:
 * the host launcher beside the runtime store, the path every Lervo session takes, when it is
 * exactly this CLI's launcher and only the user can change it; otherwise the CLI's terminal hook.
 */
export async function terminalHookCommandOf(
  provider: TerminalIntegrationProvider,
  options: { launcher?: string; platform?: NodeJS.Platform } = {},
): Promise<Pick<HostedTerminalHookPlan, "command" | "via">> {
  const launcher = options.launcher ?? hostTerminalLauncherPath();
  const platform = options.platform ?? process.platform;
  return (await trustedHostTerminalLauncher(launcher))
    ? {
        command: `node ${shellWord(launcher, platform)} --provider ${provider} --contract 2`,
        via: "launcher",
      }
    : { command: `lervo terminal hook --provider ${provider} --contract 2`, via: "cli" };
}
