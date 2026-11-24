import { describe, expect, it } from "vitest";

import { idleTrack, reachedPage, trackPointer } from "../src/platform/first-click";

describe("the first click", () => {
  it("treats a click near the activation as the same click, so it never presses twice", () => {
    expect(reachedPage(1000, 990)).toBe(true);
    expect(reachedPage(1000, 1120)).toBe(true);
    expect(reachedPage(1000, Number.NEGATIVE_INFINITY)).toBe(false);
    expect(reachedPage(1000, 300)).toBe(false);
  });

  it("finds a click whose release reached the page before its press, as the owner's did", () => {
    // Recorded on the owner's Mac: pointerup at (52.4, 771.5), then pointerdown 14 ms later.
    const up = trackPointer(idleTrack, "up", 52.4, 771.5, 8454);
    expect(up.reversed).toBe(false);
    const down = trackPointer(up.track, "down", 52.4, 771.5, 8468);
    expect(down.reversed).toBe(true);
  });

  it("leaves ordinary clicks, late presses, and far presses alone", () => {
    const pressed = trackPointer(idleTrack, "down", 10, 10, 0);
    expect(pressed.reversed).toBe(false);
    const released = trackPointer(pressed.track, "up", 10, 10, 80);
    expect(trackPointer(released.track, "down", 10, 10, 120).reversed).toBe(false);
    const unpaired = trackPointer(idleTrack, "up", 10, 10, 0).track;
    expect(trackPointer(unpaired, "down", 10, 10, 400).reversed).toBe(false);
    expect(trackPointer(unpaired, "down", 60, 10, 20).reversed).toBe(false);
  });
});
