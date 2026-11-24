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
