import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLAUDE_SESSION_MARKERS,
  claudeTranscriptPath,
  createClaudeHostedSessionAdapter,
  readClaudeTranscript,
} from "../src/index.js";

const session = {
  sessionId: "01c2ec6c-85b1-4314-8dd6-4a7ab3389659",
  workingDirectory: "/Users/me/orca/lervo-wt/work-3b756e",
};
const at = (second: number) => `2026-11-23T05:19:${String(second).padStart(2, "0")}.000Z`;

/** A transcript as Claude Code writes it: both modes' turns, with lines the conversation omits. */
const lines = [
  { type: "session-owner", sessionId: session.sessionId },
  { type: "user", timestamp: at(1), message: { role: "user", content: "테스트" } },
  {
    type: "assistant",
    timestamp: at(2),
    message: { content: [{ type: "thinking", thinking: "…" }] },
  },
  {
    type: "assistant",
    timestamp: at(3),
    message: {
      content: [{ type: "tool_use", id: "tool_1", name: "Bash", input: { command: "git status" } }],
    },
  },
  {
    type: "user",
    timestamp: at(4),
    message: {
      content: [{ type: "tool_result", tool_use_id: "tool_1", content: "clean", is_error: false }],
    },
  },
  {
    type: "assistant",
    timestamp: at(5),
    message: { content: [{ type: "text", text: "변경 사항 없이 깨끗한 상태예요." }] },
  },
  { type: "user", timestamp: at(6), isMeta: true, message: { content: "<local-command-caveat>" } },
  {
    type: "assistant",
    timestamp: at(7),
    isSidechain: true,
    message: { content: [{ type: "text", text: "subagent" }] },
  },
  {
    type: "user",
    timestamp: at(8),
    message: { content: [{ type: "text", text: "Terminal에서 보낸 메시지" }] },
  },
];

describe("Claude Code transcripts", () => {
  it("names the transcript file from the working directory and the session", () => {
    expect(claudeTranscriptPath(session, { CLAUDE_CONFIG_DIR: "/home/me/.claude" })).toBe(
      "/home/me/.claude/projects/-Users-me-orca-lervo-wt-work-3b756e/01c2ec6c-85b1-4314-8dd6-4a7ab3389659.jsonl",
    );
  });

  it("reads the conversation of both modes and skips what the conversation does not show", async () => {
    const configuration = await mkdtemp(join(tmpdir(), "lervo-claude-transcript-"));
    try {
      const path = claudeTranscriptPath(session, { CLAUDE_CONFIG_DIR: configuration });
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(
        path,
        [...lines.map((line) => JSON.stringify(line)), "{not json", ""].join("\n"),
      );
      const items = [];
      for await (const item of readClaudeTranscript(session, { CLAUDE_CONFIG_DIR: configuration }))
        items.push(item);
      expect(items).toEqual([
        { content: { kind: "user_message", text: "테스트" }, createdAtMs: Date.parse(at(1)) },
        {
          content: { kind: "tool_activity", name: "Bash", status: "succeeded", calls: 1 },
          createdAtMs: Date.parse(at(4)),
        },
        {
          content: { kind: "agent_message", text: "변경 사항 없이 깨끗한 상태예요." },
          createdAtMs: Date.parse(at(5)),
        },
        {
          content: { kind: "user_message", text: "Terminal에서 보낸 메시지" },
          createdAtMs: Date.parse(at(8)),
        },
      ]);
    } finally {
      await rm(configuration, { recursive: true, force: true });
    }
  });

  it("reads nothing when Claude Code kept no transcript", async () => {
    const items = [];
    for await (const item of readClaudeTranscript(session, { CLAUDE_CONFIG_DIR: "/nonexistent" }))
      items.push(item);
    expect(items).toEqual([]);
  });

  it("keeps an enclosing session's markers away from hosted sessions", () => {
    const launch = createClaudeHostedSessionAdapter("/opt/claude").prepareLaunch({
      sessionId: session.sessionId,
      mode: "cli",
      workingDirectory: session.workingDirectory,
      start: { kind: "resume" },
    });
    expect(launch.environmentRemove).toEqual(CLAUDE_SESSION_MARKERS);
    expect(launch.environmentRemove).toContain("CLAUDE_CODE_CHILD_SESSION");
    expect(launch.environmentRemove).not.toContain("CLAUDE_CODE_USE_BEDROCK");
  });

  it("turns auto memory off in hosted sessions only, so owner rules reach Lervo", () => {
    const adapter = createClaudeHostedSessionAdapter("/opt/claude");
    for (const mode of ["native", "cli"] as const) {
      const launch = adapter.prepareLaunch({
        sessionId: session.sessionId,
        mode,
        workingDirectory: session.workingDirectory,
        start: { kind: "resume" },
      });
      expect(launch.environment).toEqual({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
      // The launch never rewrites the owner's settings: only the session's own hooks file.
      expect(launch.settingsFile).toBeNull();
      expect(launch.environmentRemove).not.toContain("CLAUDE_CODE_DISABLE_AUTO_MEMORY");
    }
  });
});
