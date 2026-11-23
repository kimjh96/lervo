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
      "--permission-mode",
      "auto",
      "--session-id",
      sessionId,
      "--model",
      "opus",
    ]);
    expect(launch.initialInput).toBe("Fix the build.");
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
