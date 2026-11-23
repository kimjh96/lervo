import { describe, expect, it } from "vitest";

import { FrameBoundWriter } from "../src/features/terminal/model/frames";

describe("terminal output per frame", () => {
  it("writes at most the budget each frame and carries the rest, in order", () => {
    const frames: (() => void)[] = [];
    const written: number[][] = [];
    const writer = new FrameBoundWriter(
      (bytes) => written.push([...bytes]),
      (run) => frames.push(run),
      4,
    );
    writer.add(new Uint8Array([1, 2, 3]));
    writer.add(new Uint8Array([4, 5, 6]));
    expect(frames).toHaveLength(1);
    frames.shift()?.();
    frames.shift()?.();
    expect(written).toEqual([
      [1, 2, 3, 4],
      [5, 6],
    ]);
    expect(frames).toHaveLength(0);
  });
});
