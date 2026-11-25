import { interruptsTurns } from "@lervo/adapter-contract";
import { describe, expect, it } from "vitest";

import { ClaudeHostedStreamDecoder } from "../src/index.js";

function bytes(lines: readonly object[]): Uint8Array {
  return new TextEncoder().encode(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
}

const streaming = [
  { type: "stream_event", event: { type: "message_start" } },
  {
    type: "stream_event",
    event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  },
  {
    type: "stream_event",
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "1\n2" } },
  },
];

const stopped = { type: "control_response", response: { subtype: "success" } };
const notice = (code: string, parameters: Record<string, string> = {}) => ({
  kind: "item",
  content: { kind: "lervo_notice", code, parameters },
  createdAtMs: 5,
});

/** A decoder in a turn that streams text, as Claude Code 2.x prints it. */
function inTurn(): ClaudeHostedStreamDecoder {
  const decoder = new ClaudeHostedStreamDecoder(() => 5);
  decoder.send("Count to 300.");
  decoder.output(bytes(streaming));
  return decoder;
}

describe("stopping a Claude Code turn", () => {
  it("asks Claude Code with a control request, only while a turn runs", () => {
    const decoder = new ClaudeHostedStreamDecoder(() => 5);
    expect(interruptsTurns(decoder)).toBe(true);
    expect(decoder.interrupt()).toEqual({ input: new Uint8Array(), events: [] });
    decoder.send("Count to 300.");
    const first = decoder.interrupt();
    expect(first.events).toEqual([]);
    expect(JSON.parse(new TextDecoder().decode(first.input))).toEqual({
      type: "control_request",
      request_id: "lervo_interrupt_1",
      request: { subtype: "interrupt" },
    });
    expect(new TextDecoder().decode(first.input).endsWith("\n")).toBe(true);
    // Each request has its own ID.
    expect(JSON.parse(new TextDecoder().decode(decoder.interrupt().input))).toMatchObject({
      request_id: "lervo_interrupt_2",
    });
  });

  it("ends a stopped streaming turn with the stopped notice, not a failure", () => {
    const decoder = inTurn();
    decoder.interrupt();
    // Claude Code 2.1.x, observed 2026-11-25: an error result with `aborted_streaming`.
    const events = decoder.output(
      bytes([
        stopped,
        {
          type: "user",
          message: { content: [{ type: "text", text: "[Request interrupted by user]" }] },
        },
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          terminal_reason: "aborted_streaming",
        },
      ]),
    );
    expect(events).toEqual([
      { kind: "finish" },
      notice("turn_stopped"),
      { kind: "status", event: "turn_finished" },
    ]);
    // The next turn is the session's own, and a failure there is a failure again.
    decoder.send("Go on.");
    expect(
      decoder.output(bytes([{ type: "result", subtype: "error_max_turns", is_error: true }])),
    ).toEqual([
      notice("provider_turn_failed", { subtype: "error_max_turns" }),
      {
        kind: "status",
        event: "turn_finished",
      },
    ]);
  });

  it("ends a turn stopped during a tool with the stopped notice", () => {
    const decoder = new ClaudeHostedStreamDecoder(() => 5);
    decoder.send("Run sleep 20.");
    decoder.interrupt();
    const events = decoder.output(
      bytes([
        { type: "result", subtype: "success", is_error: false, terminal_reason: "aborted_tools" },
      ]),
    );
    expect(events).toEqual([notice("turn_stopped"), { kind: "status", event: "turn_finished" }]);
  });

  it("does not call a turn that finished before the request arrived stopped", () => {
    const decoder = inTurn();
    decoder.interrupt();
    const events = decoder.output(
      bytes([
        { type: "result", subtype: "success", is_error: false, terminal_reason: "completed" },
      ]),
    );
    expect(events).toEqual([{ kind: "finish" }, { kind: "status", event: "turn_finished" }]);
  });

  it("takes the request's word from a Claude Code without a terminal reason", () => {
    const decoder = inTurn();
    decoder.interrupt();
    expect(
      decoder.output(
        bytes([{ type: "result", subtype: "error_during_execution", is_error: true }]),
      ),
    ).toEqual([
      { kind: "finish" },
      notice("turn_stopped"),
      { kind: "status", event: "turn_finished" },
    ]);
    // Without a request, the same result is a failure.
    const unasked = inTurn();
    expect(
      unasked.output(
        bytes([{ type: "result", subtype: "error_during_execution", is_error: true }]),
      ),
    ).toContainEqual(notice("provider_turn_failed", { subtype: "error_during_execution" }));
  });
});
