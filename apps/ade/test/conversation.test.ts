import type { ConversationItem } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { DeltaBuffer } from "../src/features/conversation/model/deltas";
import {
  applyAppended,
  applyDelta,
  applyPage,
  emptyWindow,
  MAX_WINDOW_ITEMS,
} from "../src/features/conversation/model/window";

function agent(
  position: number,
  text = `item ${position}`,
  state: "streaming" | "complete" = "complete",
): ConversationItem {
  return {
    kind: "agent_message",
    itemId: `i${position.toString(16)}`,
    createdAtMs: position,
    state,
    text,
  };
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, index) => agent(from + index));

describe("the conversation window", () => {
  it("loads the newest page and extends it with earlier pages", () => {
    const latest = applyPage(
      emptyWindow,
      { items: range(100, 200), hasEarlier: true, hasLater: false },
      "latest",
    );
    const earlier = applyPage(
      latest,
      { items: range(0, 100), hasEarlier: false, hasLater: true },
      "before",
    );
    expect(earlier.items).toHaveLength(200);
    expect(earlier.items[0]?.itemId).toBe("i0");
    expect(earlier.hasEarlier).toBe(false);
    expect(earlier.hasLater).toBe(false);
  });

  it("stays bounded, trimming the side away from what the user reads", () => {
    let window = applyPage(
      emptyWindow,
      { items: range(0, MAX_WINDOW_ITEMS), hasEarlier: false, hasLater: false },
      "latest",
    );
    window = applyAppended(window, [agent(MAX_WINDOW_ITEMS)]);
    expect(window.items).toHaveLength(MAX_WINDOW_ITEMS);
    expect(window.items[0]?.itemId).toBe("i1");
    expect(window.hasEarlier).toBe(true);
    const back = applyPage(
      window,
      { items: [agent(0)], hasEarlier: false, hasLater: true },
      "before",
    );
    expect(back.items).toHaveLength(MAX_WINDOW_ITEMS);
    expect(back.items[0]?.itemId).toBe("i0");
    expect(back.hasLater).toBe(true);
  });

  it("completes a streaming item by replacing it, and appends live items only at the live end", () => {
    let window = applyPage(
      emptyWindow,
      { items: [agent(1, "Hel", "streaming")], hasEarlier: false, hasLater: false },
      "latest",
    );
    window = applyDelta(window, "i1", "lo");
    expect(window.items[0]).toMatchObject({ text: "Hello", state: "streaming" });
    window = applyAppended(window, [agent(1, "Hello", "complete"), agent(2)]);
    expect(window.items.map((item) => [item.itemId, item.state])).toEqual([
      ["i1", "complete"],
      ["i2", "complete"],
    ]);
    const reading = { ...window, hasLater: true };
    expect(applyAppended(reading, [agent(3)]).items).toHaveLength(2);
    expect(applyDelta(window, "i9", "lost")).toBe(window);
  });
});

describe("the delta buffer", () => {
  it("merges deltas and releases them once per frame or on demand", () => {
    const frames: (() => void)[] = [];
    const released: [string, string][][] = [];
    const buffer = new DeltaBuffer(
      (deltas) => released.push([...deltas]),
      (run) => frames.push(run),
    );
    buffer.add("i1", "Hel");
    buffer.add("i1", "lo");
    buffer.add("i2", "!");
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(released).toEqual([
      [
        ["i1", "Hello"],
        ["i2", "!"],
      ],
    ]);
    buffer.add("i1", " world");
    buffer.release();
    frames[1]?.();
    expect(released).toEqual([
      [
        ["i1", "Hello"],
        ["i2", "!"],
      ],
      [["i1", " world"]],
    ]);
  });
});
