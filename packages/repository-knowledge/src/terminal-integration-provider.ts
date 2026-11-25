import { homedir } from "node:os";
import { resolve } from "node:path";

import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { sha256 } from "./integrity.js";
import { isObject } from "./terminal-integration-files.js";
import {
  FORMAT,
  terminalIntegrationEvents,
  RUNTIME_PATH,
  type TerminalIntegrationProvider,
  type TerminalIntegrationTarget,
  type TerminalIntegrationBlocker,
} from "./terminal-integration-contract.js";

export function configurationPath(
  provider: TerminalIntegrationProvider,
): TerminalIntegrationTarget["path"] {
  return provider === "codex" ? ".codex/hooks.json" : ".claude/settings.json";
}

export function terminalHookCommand(provider: TerminalIntegrationProvider): string {
  return `node "$(git rev-parse --show-toplevel)/${RUNTIME_PATH}" --provider ${provider} --contract 2`;
}

export function terminalHookWindowsCommand(provider: TerminalIntegrationProvider): string {
  return `powershell.exe -NoProfile -NonInteractive -Command "$root = git rev-parse --show-toplevel; if ($LASTEXITCODE -ne 0) { exit 2 }; & node (Join-Path $root '${RUNTIME_PATH}') --provider ${provider} --contract 2"`;
}

function hookEntry(provider: TerminalIntegrationProvider): Record<string, unknown> {
  return {
    hooks: [
      {
        type: "command",
        command: terminalHookCommand(provider),
        ...(provider === "codex" ? { commandWindows: terminalHookWindowsCommand(provider) } : {}),
        timeout: 30,
      },
    ],
  };
}

export function codexHooksDisabled(content: string): boolean {
  let section = "";
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    const heading = /^\[([^\]]+)\]$/u.exec(line);
    if (heading !== null) {
      section = heading[1]!.trim();
      continue;
    }
    if (section === "features" && /^hooks\s*=\s*false\s*$/iu.test(line)) return true;
  }
  return false;
}

function lervoTerminalProvider(command: string): TerminalIntegrationProvider | null {
  if (!(/\blervo\s+terminal\s+hook\b/u.test(command) || command.includes(RUNTIME_PATH)))
    return null;
  if (/--provider\s+codex\b/u.test(command)) return "codex";
  if (/--provider\s+claude\b/u.test(command)) return "claude";
  return null;
}

export function mergeTarget(
  provider: TerminalIntegrationProvider,
  existing: { content: string; contentHash: string } | null,
): {
  target: TerminalIntegrationTarget;
  content?: string;
  blocker?: TerminalIntegrationBlocker;
} {
  const path = configurationPath(provider);
  const original = existing?.content ?? "{}\n";
  const errors: ParseError[] = [];
  const parsed = parse(original, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0 || !isObject(parsed)) {
    return {
      target: {
        provider,
        path,
        action: "blocked",
        beforeHash: existing?.contentHash ?? null,
        afterHash: null,
      },
      blocker: { provider, path, code: "invalid_json" },
    };
  }
  if (provider === "claude" && parsed.disableAllHooks === true) {
    return {
      target: {
        provider,
        path,
        action: "blocked",
        beforeHash: existing?.contentHash ?? null,
        afterHash: null,
      },
      blocker: { provider, path, code: "hooks_disabled" },
    };
  }
  if (parsed.hooks !== undefined && !isObject(parsed.hooks)) {
    return {
      target: {
        provider,
        path,
        action: "blocked",
        beforeHash: existing?.contentHash ?? null,
        afterHash: null,
      },
      blocker: { provider, path, code: "invalid_hook_shape" },
    };
  }

  let output = original;
  for (const event of terminalIntegrationEvents(provider)) {
    const current = parse(output, [], {
      allowTrailingComma: true,
      disallowComments: false,
    }) as Record<string, unknown>;
    const hooks = isObject(current.hooks) ? current.hooks : {};
    const eventEntries = hooks[event] === undefined ? [] : hooks[event];
    if (!Array.isArray(eventEntries) || !eventEntries.every(isObject)) {
      return {
        target: {
          provider,
          path,
          action: "blocked",
          beforeHash: existing?.contentHash ?? null,
          afterHash: null,
        },
        blocker: { provider, path, code: "invalid_hook_shape" },
      };
    }
    let found = false;
    let lervoHandlerCount = 0;
    const expectedCommand = terminalHookCommand(provider);
    for (const group of eventEntries) {
      if (!Array.isArray(group.hooks) || !group.hooks.every(isObject)) {
        return {
          target: {
            provider,
            path,
            action: "blocked",
            beforeHash: existing?.contentHash ?? null,
            afterHash: null,
          },
          blocker: { provider, path, code: "invalid_hook_shape" },
        };
      }
      for (const handler of group.hooks) {
        if (typeof handler.command !== "string") continue;
        const commandProvider = lervoTerminalProvider(handler.command);
        if (commandProvider === provider) {
          lervoHandlerCount += 1;
          found ||=
            handler.command === expectedCommand &&
            handler.type === "command" &&
            handler.timeout === 30 &&
            (provider !== "codex" ||
              handler.commandWindows === terminalHookWindowsCommand(provider));
        } else if (
          commandProvider !== null ||
          /\blervo\s+terminal\s+hook\b/u.test(handler.command) ||
          handler.command.includes(RUNTIME_PATH)
        ) {
          return {
            target: {
              provider,
              path,
              action: "blocked",
              beforeHash: existing?.contentHash ?? null,
              afterHash: null,
            },
            blocker: { provider, path, code: "conflicting_lervo_hook" },
          };
        }
      }
    }
    if (lervoHandlerCount > 0 && (!found || lervoHandlerCount > 1)) {
      const next: Record<string, unknown>[] = eventEntries.flatMap((group) => {
        const handlers = (group.hooks as Record<string, unknown>[]).filter(
          (handler) =>
            typeof handler.command !== "string" ||
            lervoTerminalProvider(handler.command) !== provider,
        );
        return handlers.length === 0 ? [] : [{ ...group, hooks: handlers }];
      });
      next.push(hookEntry(provider));
      output = applyEdits(
        output,
        modify(output, ["hooks", event], next, { formattingOptions: FORMAT }),
      );
    } else if (!found) {
      output = applyEdits(
        output,
        modify(output, ["hooks", event], [...eventEntries, hookEntry(provider)], {
          formattingOptions: FORMAT,
        }),
      );
    }
  }
  const afterHash = sha256(output);
  return {
    target: {
      provider,
      path,
      action:
        existing === null ? "create" : existing.contentHash === afterHash ? "unchanged" : "update",
      beforeHash: existing?.contentHash ?? null,
      afterHash,
    },
    content: output,
  };
}

/** The sources a Claude `SessionStart` answers; a matcher may limit a handler to some of them. */
const SESSION_START_SOURCES = ["startup", "resume", "clear", "compact"] as const;

/**
 * Every settings file a provider merges into a session in `worktree`, from managed policy to the
 * worktree's local file, so a hosted session can tell which events Lervo's hooks already cover.
 */
export function providerHookSettingsFiles(
  provider: TerminalIntegrationProvider,
  worktree: string,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (provider === "codex")
    return [resolve(home, ".codex/hooks.json"), resolve(worktree, configurationPath(provider))];
  // Windows releases have used both places; reading a missing file costs nothing.
  const managed =
    platform === "darwin"
      ? ["/Library/Application Support/ClaudeCode/managed-settings.json"]
      : platform === "win32"
        ? [
            "C:\\Program Files\\ClaudeCode\\managed-settings.json",
            "C:\\ProgramData\\ClaudeCode\\managed-settings.json",
          ]
        : ["/etc/claude-code/managed-settings.json"];
  const user = environment.CLAUDE_CONFIG_DIR ?? resolve(home, ".claude");
  return [
    ...managed,
    resolve(user, "settings.json"),
    resolve(worktree, configurationPath(provider)),
    resolve(worktree, ".claude/settings.local.json"),
  ];
}

/**
 * The sources a handler's matcher selects. Absent, empty, or `*` select every source; otherwise
 * the matcher is a regular expression tested against each source, as the provider tests it. A
 * matcher that is no valid expression counts as selecting every source, so Lervo never runs twice.
 */
function selectedSources(matcher: unknown): readonly string[] {
  if (typeof matcher !== "string" || matcher.trim() === "" || matcher.trim() === "*")
    return SESSION_START_SOURCES;
  try {
    const expression = new RegExp(matcher, "u");
    return SESSION_START_SOURCES.filter((source) => expression.test(source));
  } catch {
    return SESSION_START_SOURCES;
  }
}

/**
 * Each hook handler in a provider settings file, as `{ event, matcher, command }`. A file that
 * does not parse, comments and trailing commas allowed, has none: the provider ignores it.
 */
function settingsHandlers(
  content: string,
): { event: string; matcher: unknown; commands: string[] }[] {
  const errors: ParseError[] = [];
  const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0 || !isObject(parsed) || !isObject(parsed.hooks)) return [];
  const handlers: { event: string; matcher: unknown; commands: string[] }[] = [];
  for (const [event, entries] of Object.entries(parsed.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isObject(entry) || !Array.isArray(entry.hooks)) continue;
      const commands = entry.hooks
        .map((hook) => (isObject(hook) ? hook.command : undefined))
        .filter((command): command is string => typeof command === "string");
      handlers.push({ event, matcher: entry.matcher, commands });
    }
  }
  return handlers;
}

/**
 * The provider events Lervo's terminal hook is missing from across `settings`, the contents of
 * the files a session merges. A handler counts when it runs `lervo terminal hook`, or the
 * repository's launcher while `launcher` says the launcher is present. Settings are read as the
 * installer reads them, comments and trailing commas allowed; a file that does not parse counts
 * as absent, as the provider then ignores it. A `SessionStart` that covers only some sources
 * leaves the rest, which the returned matcher names.
 */
export function missingTerminalHookEvents(
  provider: TerminalIntegrationProvider,
  settings: readonly string[],
  launcher: boolean,
): { name: string; matcher?: string }[] {
  const covered = new Map<string, Set<string>>();
  for (const handler of settings.flatMap(settingsHandlers)) {
    const lervo = handler.commands.some(
      (command) =>
        lervoTerminalProvider(command) === provider &&
        (launcher || /\blervo\s+terminal\s+hook\b/u.test(command)),
    );
    if (!lervo) continue;
    const sources = covered.get(handler.event) ?? new Set<string>();
    const selected = handler.event === "SessionStart" ? selectedSources(handler.matcher) : ["all"];
    for (const source of selected) sources.add(source);
    covered.set(handler.event, sources);
  }
  const missing: { name: string; matcher?: string }[] = [];
  for (const event of terminalIntegrationEvents(provider)) {
    const sources = covered.get(event);
    if (event !== "SessionStart") {
      if (sources === undefined) missing.push({ name: event });
      continue;
    }
    const left = SESSION_START_SOURCES.filter((source) => !sources?.has(source));
    if (left.length === SESSION_START_SOURCES.length) missing.push({ name: event });
    else if (left.length > 0) missing.push({ name: event, matcher: left.join("|") });
  }
  return missing;
}

/**
 * The events whose handlers in `content`, a settings file Lervo wrote for a hosted session, run
 * exactly `command`, with the matcher written for each: what the file proves it added.
 */
export function terminalHookEventsRunning(
  content: string,
  command: string,
): { name: string; matcher?: string }[] {
  return settingsHandlers(content)
    .filter((handler) => handler.commands.includes(command))
    .map((handler) =>
      typeof handler.matcher === "string" && handler.matcher !== ""
        ? { name: handler.event, matcher: handler.matcher }
        : { name: handler.event },
    );
}
