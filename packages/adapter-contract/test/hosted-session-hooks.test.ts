import { describe, expect, it } from "vitest";

import { hostedSessionHooksProblem } from "../src/hosted-session-hooks.js";

const hooks = { settingsPath: "/state/session.json", command: "lervo workspace hook" };

describe("a hosted session's hooks", () => {
  it("accepts terminal hooks with known, unique events and a SessionStart matcher", () => {
    expect(
      hostedSessionHooksProblem({
        ...hooks,
        terminal: {
          command:
            "node /home/me/.lervo/terminal-hooks/launcher.mjs --provider claude --contract 2",
          events: [{ name: "SessionStart", matcher: "resume|compact" }, { name: "Stop" }],
        },
      }),
    ).toBeNull();
  });

  it("refuses an empty or multi-line command, no events, duplicates, unknown events, and stray matchers", () => {
    const terminal = (value: object) =>
      hostedSessionHooksProblem({ ...hooks, terminal: { command: "lervo", events: [], ...value } });
    expect(terminal({ command: "", events: [{ name: "Stop" }] })).not.toBeNull();
    expect(terminal({ command: "a\nb", events: [{ name: "Stop" }] })).not.toBeNull();
    expect(terminal({})).not.toBeNull();
    expect(terminal({ events: [{ name: "Stop" }, { name: "Stop" }] })).not.toBeNull();
    expect(terminal({ events: [{ name: "PreToolUse" }] })).not.toBeNull();
    expect(terminal({ events: [{ name: "PreToolUse", matcher: "edit" }] })).not.toBeNull();
    const claim = { name: "PreToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash" };
    expect(terminal({ events: [claim] })).not.toBeNull();
    expect(terminal({ events: [claim], claimCommand: "lervo --claim" })).toBeNull();
    expect(terminal({ events: [{ name: "Stop", matcher: "resume" }] })).not.toBeNull();
    expect(terminal({ events: [{ name: "SessionStart", matcher: "resume; rm" }] })).not.toBeNull();
  });
});
