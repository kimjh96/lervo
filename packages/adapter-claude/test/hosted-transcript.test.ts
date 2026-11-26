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
  {
    type: "user",
    timestamp: at(9),
    isMeta: true,
    origin: { kind: "peer", name: "lervo-b9", body: "Please canary the ADE." },
    message: { content: "Another Claude session sent a message: <cross-session-message>…" },
  },
  {
    type: "system",
    subtype: "compact_boundary",
    timestamp: at(9),
    content: "Conversation compacted",
    compactMetadata: { trigger: "auto", preTokens: 968011 },
  },
  // A slash command, as Claude Code records it: the command, the skill it loaded, and the local
  // output of a built-in command.
  {
    type: "user",
    timestamp: at(11),
    message: {
      content:
        "<command-message>dataviz</command-message>\n<command-name>/dataviz</command-name>\n<command-args>Which file holds the palette?</command-args>",
    },
  },
  {
    type: "user",
    timestamp: at(11),
    isMeta: true,
    message: { content: [{ type: "text", text: "Base directory for this skill: …" }] },
  },
  {
    type: "user",
    timestamp: at(12),
    message: {
      content:
        "<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>",
    },
  },
  {
    type: "user",
    timestamp: at(12),
    message: { content: "<local-command-stdout>Compacted </local-command-stdout>" },
  },
  // A message with an image keeps the image's mark, never its bytes.
  {
    type: "user",
    timestamp: at(13),
    message: {
      content: [
        { type: "text", text: "이 화면 봐줘" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAfFcSJ",
          },
        },
      ],
    },
  },
  // Images sent alone carry Claude Code's placeholders as their text.
  {
    type: "user",
    timestamp: at(14),
    message: {
      content: [
        { type: "text", text: "[Image #1]" },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAAfFcSJ",
          },
        },
      ],
    },
  },
  {
    type: "user",
    timestamp: at(10),
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    message: { content: "This session is being continued from a previous conversation." },
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
          content: {
            kind: "tool_activity",
            name: "Bash",
            status: "succeeded",
            calls: 1,
            detail: {
              subject: { kind: "command", text: "git status" },
              preview: { format: "output", lines: ["clean"], omittedLines: 0, omittedAt: 1 },
            },
            output: "clean",
          },
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
        // Another session's message shows as that session's, though the transcript marks it meta.
        {
          content: { kind: "peer_message", from: "lervo-b9", text: "Please canary the ADE." },
          createdAtMs: Date.parse(at(9)),
        },
        // A compaction shows as its notice; the summary it wrote for the model does not show.
        {
          content: {
            kind: "lervo_notice",
            code: "context_compacted",
            parameters: { trigger: "auto" },
          },
          createdAtMs: Date.parse(at(9)),
        },
        // A slash command reads as typed; what it loaded and printed does not show.
        {
          content: { kind: "user_message", text: "/dataviz Which file holds the palette?" },
          createdAtMs: Date.parse(at(11)),
        },
        { content: { kind: "user_message", text: "/compact" }, createdAtMs: Date.parse(at(12)) },
        {
          content: {
            kind: "user_message",
            text: "이 화면 봐줘",
            images: [
              {
                mediaType: "image/png",
                width: 2,
                height: 1,
                imageId: "535576c2c306112bc2ee4680abf9b52d6e29cf98b0324f0a11c60a4f12be9e36",
              },
            ],
          },
          createdAtMs: Date.parse(at(13)),
        },
        {
          content: {
            kind: "user_message",
            text: "",
            images: [
              {
                mediaType: "image/png",
                width: 2,
                height: 1,
                imageId: "535576c2c306112bc2ee4680abf9b52d6e29cf98b0324f0a11c60a4f12be9e36",
              },
            ],
          },
          createdAtMs: Date.parse(at(14)),
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

describe("Claude Code transcripts with questions", () => {
  it("reads an AskUserQuestion call as the question and its answers as the person's message", async () => {
    const configuration = await mkdtemp(join(tmpdir(), "lervo-claude-questions-"));
    try {
      const path = claudeTranscriptPath(session, { CLAUDE_CONFIG_DIR: configuration });
      await mkdir(join(path, ".."), { recursive: true });
      const asked = {
        questions: [
          {
            question: "Which layout?",
            header: "Layout",
            multiSelect: false,
            options: [
              { label: "Grid", description: "" },
              { label: "List", description: "" },
            ],
          },
        ],
      };
      await writeFile(
        path,
        [
          {
            type: "assistant",
            timestamp: "2026-11-27T00:00:01.000Z",
            message: {
              content: [
                { type: "tool_use", id: "toolu_ask", name: "AskUserQuestion", input: asked },
              ],
            },
          },
          {
            type: "user",
            timestamp: "2026-11-27T00:00:02.000Z",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_ask",
                  content: 'Your questions have been answered: "Which layout?"="Grid".',
                },
              ],
            },
            toolUseResult: { ...asked, answers: { "Which layout?": "Grid" } },
          },
        ]
          .map((line) => JSON.stringify(line))
          .join("\n"),
      );
      const items = [];
      for await (const item of readClaudeTranscript(session, { CLAUDE_CONFIG_DIR: configuration }))
        items.push(item.content);
      expect(items).toEqual([
        { kind: "question", text: "Which layout?" },
        { kind: "user_message", text: "Grid" },
      ]);
    } finally {
      await rm(configuration, { recursive: true, force: true });
    }
  });
});
