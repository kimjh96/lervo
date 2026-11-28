import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ARRIVAL_MS,
  forgetArrivals,
  withoutArrivals,
} from "../src/features/conversation/model/arrivals";

afterEach(() => {
  vi.useRealTimers();
});

describe("arrivals", () => {
  it("forgets items once their entrance has played, so history never replays it", () => {
    vi.useFakeTimers();
    let arrived: ReadonlySet<string> = new Set(["a", "b"]);
    forgetArrivals(["a"], (done) => {
      arrived = withoutArrivals(arrived, done);
    });
    vi.advanceTimersByTime(ARRIVAL_MS - 1);
    expect([...arrived]).toEqual(["a", "b"]);
    vi.advanceTimersByTime(1);
    expect([...arrived]).toEqual(["b"]);
  });

  it("keeps the same set when none of the forgotten items is in it", () => {
    const arrived = new Set(["b"]);
    expect(withoutArrivals(arrived, new Set(["a"]))).toBe(arrived);
  });
});
