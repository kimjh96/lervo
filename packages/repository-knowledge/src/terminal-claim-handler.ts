// The claim handler in a conversation worktree's local provider settings (Lervo ADE coordination,
// "Where the handler runs"). Lervo owns one `PreToolUse` group there, the one whose handler runs
// Lervo's terminal hook with `--claim`. Every other entry is the user's and stays,
// as the installer keeps the user's handlers in `.claude/settings.json`.
import { applyEdits, type FormattingOptions, modify, parse, type ParseError } from "jsonc-parser";

import { isObject } from "./terminal-integration-files.js";

/** The claim handler Lervo writes: its command, the tools it matches, and its timeout. */
export interface ClaimHandler {
  readonly command: string;
  readonly matcher: string;
  readonly timeoutSeconds: number;
}

/** Why Lervo left a settings file as it was rather than write its claim handler there. */
export type ClaimHandlerBlocker =
  | "settings_unreadable"
  | "invalid_hook_shape"
  /** A group runs Lervo's claim handler beside a handler of the user's. */
  | "handler_shared";

export type ClaimHandlerMerge =
  | { readonly content: string; readonly changed: boolean }
  | { readonly blocker: ClaimHandlerBlocker };

const FORMAT: FormattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };

/** Whether `command` runs Lervo's terminal hook as the claim handler, through any launcher. */
function isClaimCommand(command: unknown): boolean {
  return (
    typeof command === "string" &&
    /--provider\s+[a-z]+\s+--contract\s+\d+\s+--claim(?:\s|$)/u.test(command)
  );
}

function isGroup(group: Record<string, unknown>, handler: ClaimHandler): boolean {
  const [entry, ...rest] = Array.isArray(group.hooks) ? group.hooks : [];
  return (
    Object.keys(group).length === 2 &&
    group.matcher === handler.matcher &&
    rest.length === 0 &&
    isObject(entry) &&
    Object.keys(entry).length === 3 &&
    entry.type === "command" &&
    entry.command === handler.command &&
    entry.timeout === handler.timeoutSeconds
  );
}

/**
 * The settings with `handler` as Lervo's one claim group, after the user's own `PreToolUse`
 * groups. A Lervo group from an earlier start is replaced; a file that is not settings, or whose
 * hooks Lervo cannot tell apart from the user's, is a blocker and stays as it is.
 */
export function mergeClaimHandler(
  existing: string | null,
  handler: ClaimHandler,
): ClaimHandlerMerge {
  const text = existing ?? "";
  let root: unknown = {};
  if (text.trim() !== "") {
    const errors: ParseError[] = [];
    root = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) return { blocker: "settings_unreadable" };
  }
  if (!isObject(root)) return { blocker: "settings_unreadable" };
  const hooks = root.hooks;
  if (hooks !== undefined && !isObject(hooks)) return { blocker: "invalid_hook_shape" };
  const groups = hooks?.PreToolUse ?? [];
  if (!Array.isArray(groups) || !groups.every(isObject)) return { blocker: "invalid_hook_shape" };
  const lervo: number[] = [];
  for (const [index, group] of groups.entries()) {
    if (!Array.isArray(group.hooks) || !group.hooks.every(isObject))
      return { blocker: "invalid_hook_shape" };
    const claims = group.hooks.filter((entry) => isClaimCommand(entry.command)).length;
    if (claims === 0) continue;
    if (claims !== group.hooks.length) return { blocker: "handler_shared" };
    lervo.push(index);
  }
  const current = lervo.length === 1 ? groups[lervo[0] ?? -1] : undefined;
  if (current !== undefined && isGroup(current, handler)) return { content: text, changed: false };
  let content = text.trim() === "" ? "{}\n" : text;
  for (const index of lervo.toReversed())
    content = applyEdits(
      content,
      modify(content, ["hooks", "PreToolUse", index], undefined, { formattingOptions: FORMAT }),
    );
  const group = {
    matcher: handler.matcher,
    hooks: [{ type: "command", command: handler.command, timeout: handler.timeoutSeconds }],
  };
  content = applyEdits(
    content,
    modify(content, ["hooks", "PreToolUse", -1], group, {
      formattingOptions: FORMAT,
      isArrayInsertion: true,
    }),
  );
  return { content: content.endsWith("\n") ? content : `${content}\n`, changed: true };
}

/**
 * Whether some settings file runs Lervo's claim handler for exactly `matcher`, so a hosted session
 * needs none of its own. A file that does not parse counts as absent, as the provider ignores it.
 */
export function claimHandlerCovered(settings: readonly string[], matcher: string): boolean {
  return settings.some((text) => {
    const errors: ParseError[] = [];
    const root: unknown = parse(text, errors, { allowTrailingComma: true });
    if (errors.length > 0 || !isObject(root) || !isObject(root.hooks)) return false;
    const groups = root.hooks.PreToolUse;
    return (
      Array.isArray(groups) &&
      groups.some(
        (group) =>
          isObject(group) &&
          group.matcher === matcher &&
          Array.isArray(group.hooks) &&
          group.hooks.some((entry) => isObject(entry) && isClaimCommand(entry.command)),
      )
    );
  });
}
