import { evaluateHostedSessionContract } from "@lervo/adapter-contract";
import { describe, expect, it } from "vitest";

import { createClaudeHostedSessionAdapter } from "../src/index.js";

const sessionId = "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c";
const adapter = createClaudeHostedSessionAdapter("/opt/claude");

describe("Claude Code hosted sessions", () => {
  it("passes the common hosted-session checks", () => {
    expect(evaluateHostedSessionContract(adapter, "/work/repo")).toEqual([]);
  });

  it("runs the native conversation with structured streams and sends the instruction through them", () => {
    const launch = adapter.prepareLaunch({
      sessionId,
      mode: "native",
      workingDirectory: "/work/repo",
      start: { kind: "new", instruction: "Fix the build." },
      model: "opus",
    });
    expect(launch.program).toBe("/opt/claude");
    expect(launch.arguments).toEqual([
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--replay-user-messages",
      "--permission-mode",
      "bypassPermissions",
      "--session-id",
      sessionId,
      "--model",
      "opus",
    ]);
    expect(launch.initialInput).toBe("Fix the build.");
  });

  it("runs a read-access session that refuses every tool its rules do not allow", () => {
    const launch = adapter.prepareLaunch({
      sessionId,
      mode: "native",
      workingDirectory: "/work/repo",
      start: { kind: "new", instruction: "Is the Retry-After header in seconds?" },
      access: "read",
    });
    expect(launch.arguments).not.toContain("bypassPermissions");
    const mode = launch.arguments.indexOf("--permission-mode");
    expect(launch.arguments[mode + 1]).toBe("dontAsk");
    const allowed = launch.arguments[launch.arguments.indexOf("--allowedTools") + 1]?.split(",");
    expect(allowed).toEqual(
      expect.arrayContaining(["Read", "Grep", "WebSearch", "Bash(git log *)"]),
    );
    expect(allowed).not.toEqual(expect.arrayContaining(["Edit"]));
    expect(allowed?.some((rule) => rule === "Bash" || rule.startsWith("Write"))).toBe(false);
  });

  it("adds Lervo's start and end handlers through a session-scoped settings file", () => {
    const hooks = {
      settingsPath: "/state/hosted-settings/session.json",
      command: "lervo workspace hook --provider claude",
    };
    for (const mode of ["native", "cli"] as const) {
      const launch = adapter.prepareLaunch({
        sessionId,
        mode,
        workingDirectory: "/work/repo",
        start: { kind: "resume" },
        hooks,
      });
      const at = launch.arguments.indexOf("--settings");
      expect(launch.arguments[at + 1]).toBe(hooks.settingsPath);
      expect(launch.settingsFile?.path).toBe(hooks.settingsPath);
      const settings = JSON.parse(launch.settingsFile?.content ?? "{}") as {
        hooks: Record<string, { hooks: { type: string; command: string; timeout: number }[] }[]>;
      };
      expect(Object.keys(settings.hooks)).toEqual(["SessionStart", "SessionEnd"]);
      for (const entries of Object.values(settings.hooks))
        expect(entries).toEqual([
          { hooks: [{ type: "command", command: hooks.command, timeout: 10 }] },
        ]);
      // Nothing else in the user's settings is touched: no other keys, no disableAllHooks.
      expect(Object.keys(settings)).toEqual(["hooks"]);
    }
    const plain = adapter.prepareLaunch({
      sessionId,
      mode: "native",
      workingDirectory: "/work/repo",
      start: { kind: "resume" },
    });
    expect(plain.settingsFile).toBeNull();
    expect(plain.arguments).not.toContain("--settings");
  });

  it("adds Lervo's terminal hooks only for the events the project lacks", () => {
    const launch = adapter.prepareLaunch({
      sessionId,
      mode: "native",
      workingDirectory: "/work/repo",
      start: { kind: "resume" },
      hooks: {
        settingsPath: "/state/hosted-settings/session.json",
        command: "lervo workspace hook --provider claude",
        terminal: {
          command: "lervo terminal hook --provider claude --contract 2",
          events: [
            { name: "SessionStart", matcher: "resume|compact" },
            { name: "UserPromptSubmit" },
          ],
        },
      },
    });
    const settings = JSON.parse(launch.settingsFile?.content ?? "{}") as {
      hooks: Record<string, { hooks: { command: string; timeout: number }[] }[]>;
    };
    const commands = (event: string) =>
      (settings.hooks[event] ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command));
    expect(Object.keys(settings.hooks)).toEqual(["SessionStart", "SessionEnd", "UserPromptSubmit"]);
    expect(commands("SessionStart")).toEqual([
      "lervo workspace hook --provider claude",
      "lervo terminal hook --provider claude --contract 2",
    ]);
    expect(commands("UserPromptSubmit")).toEqual([
      "lervo terminal hook --provider claude --contract 2",
    ]);
    expect(settings.hooks.UserPromptSubmit?.[0]?.hooks[0]?.timeout).toBe(30);
    // The SessionStart handler answers only the sources the project's own hook leaves out.
    expect((settings.hooks.SessionStart?.[1] as { matcher?: string }).matcher).toBe(
      "resume|compact",
    );
    expect(settings.hooks.Stop).toBeUndefined();
  });

  it("gives a pre-tool claim handler its tools and a shorter timeout", () => {
    const launch = adapter.prepareLaunch({
      sessionId,
      mode: "native",
      workingDirectory: "/work/repo",
      start: { kind: "resume" },
      hooks: {
        settingsPath: "/state/hosted-settings/session.json",
        command: "lervo workspace hook --provider claude",
        terminal: {
          command: "lervo terminal hook --provider claude --contract 2",
          events: [{ name: "PreToolUse", matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash" }],
        },
      },
    });
    const settings = JSON.parse(launch.settingsFile?.content ?? "{}") as {
      hooks: Record<string, { matcher?: string; hooks: { timeout: number }[] }[]>;
    };
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash",
        hooks: [
          {
            type: "command",
            command: "lervo terminal hook --provider claude --contract 2",
            timeout: 10,
          },
        ],
      },
    ]);
  });

  it("resumes the CLI conversation without permission overrides", () => {
    const launch = adapter.prepareLaunch({
      sessionId,
      mode: "cli",
      workingDirectory: "/work/repo",
      start: { kind: "resume" },
    });
    expect(launch.arguments).toEqual(["--resume", sessionId]);
    expect(launch.initialInput).toBeNull();
  });
});
