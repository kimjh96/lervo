import { parse } from "jsonc-parser";
import { describe, expect, it } from "vitest";

import { claimHandlerCovered, mergeClaimHandler } from "../src/terminal-claim-handler.js";

const handler = {
  command: "lervo terminal hook --provider claude --contract 2 --claim",
  matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash",
  timeoutSeconds: 10,
};
const merged = (existing: string | null, wanted = handler) => {
  const result = mergeClaimHandler(existing, wanted);
  if ("blocker" in result) throw new Error(result.blocker);
  return result;
};

describe("the claim handler in a worktree's local settings", () => {
  it("adds one Lervo group after the user's own, keeping their entries and comments", () => {
    const user = `{
  // The owner's own
  "permissions": { "allow": ["Bash(ls:*)"] },
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "./audit.sh" }] }],
  },
}
`;
    const { content, changed } = merged(user);
    expect(changed).toBe(true);
    expect(content).toContain("// The owner's own");
    expect(content).toContain('"permissions": { "allow": ["Bash(ls:*)"] }');
    const settings = parse(content, [], { allowTrailingComma: true }) as {
      hooks: { PreToolUse: unknown[] };
    };
    expect(settings.hooks.PreToolUse[0]).toEqual({
      matcher: "Bash",
      hooks: [{ type: "command", command: "./audit.sh" }],
    });
    expect(claimHandlerCovered([content], handler.matcher)).toBe(true);
    // Once written, the same handler changes nothing.
    expect(merged(content)).toEqual({ content, changed: false });
  });

  it("writes a new file, and replaces an earlier start's group rather than adding a second", () => {
    const first = merged(null).content;
    expect(JSON.parse(first)).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: handler.matcher,
            hooks: [{ type: "command", command: handler.command, timeout: 10 }],
          },
        ],
      },
    });
    const launcher = {
      ...handler,
      command: "node '/h/launcher.mjs' --provider claude --contract 2 --claim",
    };
    const second = merged(first, launcher).content;
    expect((JSON.parse(second) as { hooks: { PreToolUse: unknown[] } }).hooks.PreToolUse).toEqual([
      {
        matcher: handler.matcher,
        hooks: [{ type: "command", command: launcher.command, timeout: 10 }],
      },
    ]);
    expect(claimHandlerCovered([second], "Edit|Write")).toBe(false);
  });

  it("leaves a file it cannot read, or a group the user shares with Lervo's handler", () => {
    expect(mergeClaimHandler("{ not json", handler)).toEqual({ blocker: "settings_unreadable" });
    expect(mergeClaimHandler("[]", handler)).toEqual({ blocker: "settings_unreadable" });
    expect(mergeClaimHandler('{ "hooks": { "PreToolUse": {} } }', handler)).toEqual({
      blocker: "invalid_hook_shape",
    });
    const shared = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: handler.command },
              { type: "command", command: "./audit.sh" },
            ],
          },
        ],
      },
    });
    expect(mergeClaimHandler(shared, handler)).toEqual({ blocker: "handler_shared" });
  });
});
