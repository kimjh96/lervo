// Every hosted session is a Lervo session (ADR-0632, S2a; Lervo ADE sessions, "Hosted launches").
// Project hooks committed in `.claude/settings.json` carry Lervo's terminal hooks in most
// repositories; the hosted launch adds them for the events a worktree's project settings lack,
// and only for those, so no event runs Lervo twice.
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { HostedSessionAdapter, HostedTerminalHooks } from "@lervo/adapter-contract";
import { TERMINAL_HOOK_RUNTIME_PATH, terminalIntegrationEvents } from "@lervo/repository-knowledge";

/** Settings files Claude Code reads from a project, in the order it merges them. */
const PROJECT_SETTINGS = [".claude/settings.json", ".claude/settings.local.json"];
const MAXIMUM_SETTINGS_BYTES = 256 * 1024;
/** The command that runs Lervo's terminal hook from the installed CLI, wherever the worktree is. */
const TERMINAL_HOOK_COMMAND = "lervo terminal hook --provider claude --contract 2";

const exists = (path: string) =>
  lstat(path).then(
    (stat) => stat.isFile(),
    () => false,
  );

/** The hook commands a settings file registers for `event`; none when it cannot be read. */
async function commandsFor(file: string, event: string): Promise<string[]> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > MAXIMUM_SETTINGS_BYTES) return [];
    const settings = JSON.parse(await readFile(file, "utf8")) as {
      hooks?: Record<string, { hooks?: { command?: unknown }[] }[]>;
    };
    const entries = settings.hooks?.[event];
    if (!Array.isArray(entries)) return [];
    return entries
      .flatMap((entry) => (Array.isArray(entry?.hooks) ? entry.hooks : []))
      .map((hook) => hook?.command)
      .filter((command): command is string => typeof command === "string");
  } catch {
    return [];
  }
}

/**
 * The provider events whose Lervo terminal hook the worktree's project settings lack. A project
 * hook counts when it runs the repository's runtime launcher and that launcher is present, or
 * when it runs the installed CLI's terminal hook.
 */
export async function missingTerminalHookEvents(worktree: string): Promise<string[]> {
  const launcher = await exists(resolve(worktree, TERMINAL_HOOK_RUNTIME_PATH));
  const missing: string[] = [];
  for (const event of terminalIntegrationEvents("claude")) {
    const commands = (
      await Promise.all(PROJECT_SETTINGS.map((file) => commandsFor(resolve(worktree, file), event)))
    ).flat();
    const hooked = commands.some(
      (command) =>
        (launcher && command.includes(TERMINAL_HOOK_RUNTIME_PATH)) ||
        command.includes("lervo terminal hook"),
    );
    if (!hooked) missing.push(event);
  }
  return missing;
}

/**
 * The terminal hooks a hosted session in `worktree` needs: the installed CLI's hook for each event
 * the project lacks, or undefined when the project hooks them all or the adapter takes no hooks.
 */
export async function hostedTerminalHooks(
  adapter: HostedSessionAdapter,
  worktree: string,
): Promise<HostedTerminalHooks | undefined> {
  if (!adapter.capabilities.hooks || adapter.provider !== "claude") return undefined;
  const events = await missingTerminalHookEvents(worktree);
  return events.length === 0 ? undefined : { command: TERMINAL_HOOK_COMMAND, events };
}
