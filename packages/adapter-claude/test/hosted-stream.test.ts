import { describe, expect, it } from "vitest";

import { ClaudeHostedStreamDecoder, createClaudeHostedSessionAdapter } from "../src/index.js";

// The shape Claude Code 2.x prints with --verbose --output-format stream-json
// --include-partial-messages, reduced to the fields the decoder reads.
const toolTurn = [
  { type: "system", subtype: "init", session_id: "s", cwd: "/work/repo" },
  { type: "stream_event", event: { type: "message_start" } },
  {
    type: "stream_event",
    event: {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "toolu_1", name: "Read" },
    },
  },
  {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "input_json_delta", partial_json: '{"file_path":' },
    },
  },
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Read",
          input: { file_path: "/work/repo/notes/a.txt" },
        },
      ],
    },
    parent_tool_use_id: null,
  },
  { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
  {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "banana split" }],
    },
    parent_tool_use_id: null,
  },
  {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "inner" }] },
    parent_tool_use_id: "toolu_1",
  },
  { type: "stream_event", event: { type: "message_start" } },
  {
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
  },
  {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "hmm" },
    },
  },
  { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
  {
    type: "stream_event",
    event: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  },
  {
    type: "stream_event",
    event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "ban" } },
  },
  {
    type: "stream_event",
    event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "ana" } },
  },
  {
    type: "assistant",
    message: { content: [{ type: "text", text: "banana" }] },
    parent_tool_use_id: null,
  },
  { type: "stream_event", event: { type: "content_block_stop", index: 1 } },
  { type: "result", subtype: "success", is_error: false },
];

function bytes(lines: readonly object[]): Uint8Array {
  return new TextEncoder().encode(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

describe("Claude Code stream decoding", () => {
  it("turns a streamed turn into items, deltas, and status, with tool paths in the workspace", () => {
    const decoder = new ClaudeHostedStreamDecoder(() => 7);
    const sent = decoder.send("Read a.txt");
    expect(JSON.parse(new TextDecoder().decode(sent.input))).toEqual({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "Read a.txt" }] },
    });
    expect(sent.events).toEqual([
      { kind: "item", content: { kind: "user_message", text: "Read a.txt" }, createdAtMs: 7 },
      { kind: "status", event: "turn_started" },
    ]);
    const events = decoder.output(bytes(toolTurn));
    expect(events).toEqual([
      {
        kind: "item",
        content: {
          kind: "tool_activity",
          name: "Read",
          status: "succeeded",
          calls: 1,
          detail: { subject: { kind: "path", text: "notes/a.txt" }, counts: { lines: 1 } },
        },
        createdAtMs: 7,
      },
      { kind: "start", content: { kind: "agent_message", text: "" }, createdAtMs: 7 },
      { kind: "delta", text: "ban" },
      { kind: "delta", text: "ana" },
      { kind: "finish" },
      { kind: "status", event: "turn_finished" },
    ]);
    // A read shows what it read, not the file's text, and never the workspace's absolute path.
    expect(JSON.stringify(events)).not.toContain("/work/repo");
    expect(JSON.stringify(events)).not.toContain("banana split");
  });

  it("decodes the same stream split at every byte, including inside characters", () => {
    const whole = bytes([
      { type: "stream_event", event: { type: "message_start" } },
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "완료했어요" },
        },
      },
      { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
      { type: "result", subtype: "error_max_turns", is_error: true },
    ]);
    const expected = new ClaudeHostedStreamDecoder(() => 1).output(whole);
    const split = new ClaudeHostedStreamDecoder(() => 1);
    const events = [...whole].flatMap((byte) => [...split.output(Uint8Array.of(byte))]);
    expect(events).toEqual(expected);
    expect(events).toEqual([
      { kind: "status", event: "turn_started" },
      { kind: "start", content: { kind: "agent_message", text: "" }, createdAtMs: 1 },
      { kind: "delta", text: "완료했어요" },
      { kind: "finish" },
      {
        kind: "item",
        content: {
          kind: "lervo_notice",
          code: "provider_turn_failed",
          parameters: { subtype: "error_max_turns" },
        },
        createdAtMs: 1,
      },
      { kind: "status", event: "turn_finished" },
    ]);
  });

  it("shows a full assistant message when nothing streamed and skips lines it cannot read", () => {
    const decoder = new ClaudeHostedStreamDecoder(() => 3);
    const events = decoder.output(
      new TextEncoder().encode(
        `not json\n${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } })}\n`,
      ),
    );
    expect(events).toEqual([
      { kind: "item", content: { kind: "agent_message", text: "Done." }, createdAtMs: 3 },
    ]);
  });

  it("drops an oversized line without holding it in memory", () => {
    const decoder = new ClaudeHostedStreamDecoder(() => 3);
    const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
    for (let index = 0; index < 17; index += 1) expect(decoder.output(chunk)).toEqual([]);
    const after = decoder.output(
      bytes([{ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }]),
    );
    expect(after).toEqual([]);
    expect(
      decoder.output(
        bytes([{ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }]),
      ),
    ).toHaveLength(1);
  });

  it("is the adapter's decoder for the native conversation", () => {
    expect(createClaudeHostedSessionAdapter().createStreamDecoder()).toBeInstanceOf(
      ClaudeHostedStreamDecoder,
    );
  });
});
