import { describe, expect, it } from "vitest";

import {
  missingTerminalHookEvents,
  providerHookSettingsFiles,
  terminalHookEventsRunning,
} from "../src/terminal-integration-provider.js";

const launcherCommand =
  'node "$(git rev-parse --show-toplevel)/.lervo/generated/terminal-hooks/runtime-v2.mjs" --provider claude --contract 2';
const hooked = (event: string, command: string, matcher?: string) =>
  JSON.stringify({
    hooks: { [event]: [{ ...(matcher === undefined ? {} : { matcher }), hooks: [{ command }] }] },
  });

describe("which terminal events Lervo's hooks already cover", () => {
  it("lists the files a Claude session merges, from managed policy to the local file", () => {
    expect(providerHookSettingsFiles("claude", "/w", {}, "/home/me", "linux")).toEqual([
      "/etc/claude-code/managed-settings.json",
      "/home/me/.claude/settings.json",
      "/w/.claude/settings.json",
      "/w/.claude/settings.local.json",
    ]);
    expect(
      providerHookSettingsFiles(
        "claude",
        "/w",
        { CLAUDE_CONFIG_DIR: "/cfg" },
        "/home/me",
        "linux",
      )[1],
    ).toBe("/cfg/settings.json");
  });

  it("counts the launcher only while it exists, and the CLI's hook always", () => {
    const all = ["SessionStart", "UserPromptSubmit", "Stop"].map((event) =>
      hooked(event, launcherCommand),
    );
    expect(missingTerminalHookEvents("claude", all, true)).toEqual([]);
    expect(missingTerminalHookEvents("claude", all, false)).toHaveLength(3);
    expect(
      missingTerminalHookEvents(
        "claude",
        [hooked("Stop", "lervo terminal hook --provider claude --contract 2")],
        false,
      ).map((event) => event.name),
    ).toEqual(["SessionStart", "UserPromptSubmit"]);
  });

  it("reads comments and trailing commas, ignores other providers' hooks, and narrows SessionStart", () => {
    const commented = `{ // Lervo\n "hooks": { "UserPromptSubmit": [ { "hooks": [ { "command": ${JSON.stringify(launcherCommand)} }, ] }, ], }, }`;
    expect(
      missingTerminalHookEvents("claude", [commented], true).map((event) => event.name),
    ).toEqual(["SessionStart", "Stop"]);
    expect(
      missingTerminalHookEvents(
        "claude",
        [hooked("Stop", launcherCommand.replace("claude", "codex"))],
        true,
      ),
    ).toHaveLength(3);
    expect(
      missingTerminalHookEvents(
        "claude",
        [hooked("SessionStart", launcherCommand, "startup")],
        true,
      )[0],
    ).toEqual({ name: "SessionStart", matcher: "resume|clear|compact" });
  });

  it("counts nothing from a file the provider cannot parse", () => {
    const broken = `${hooked("Stop", "lervo terminal hook --provider claude --contract 2")} garbage }}`;
    expect(missingTerminalHookEvents("claude", [broken], true)).toHaveLength(3);
  });

  it("tests a SessionStart matcher as a regular expression against each source", () => {
    const sessionStart = (matcher: string) =>
      missingTerminalHookEvents(
        "claude",
        [hooked("SessionStart", launcherCommand, matcher)],
        true,
      ).filter((event) => event.name === "SessionStart");
    expect(sessionStart(".*")).toEqual([]);
    expect(sessionStart("^startup$")).toEqual([
      { name: "SessionStart", matcher: "resume|clear|compact" },
    ]);
    // A matcher that is no valid expression counts as covering everything, so Lervo never runs twice.
    expect(sessionStart("(")).toEqual([]);
  });

  it("reads which events a written settings file runs a command for, with their matchers", () => {
    const command = "lervo terminal hook --provider claude --contract 2";
    const content = JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: "resume", hooks: [{ command }] }],
        Stop: [{ hooks: [{ command: "other" }] }],
      },
    });
    expect(terminalHookEventsRunning(content, command)).toEqual([
      { name: "SessionStart", matcher: "resume" },
    ]);
    expect(terminalHookEventsRunning("{ broken", command)).toEqual([]);
  });
});
