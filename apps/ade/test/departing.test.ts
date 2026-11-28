import { describe, expect, it } from "vitest";

import { departedOf, placeDeparted } from "../src/ui/departing";

const key = (item: { id: string }) => item.id;
const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };

describe("items leaving a list", () => {
  it("keeps the items that left, so they fade out where they were", () => {
    expect(departedOf([a, b, c], [a, c], [], key)).toEqual([b]);
  });

  it("keeps items already leaving, and stops an item that returns", () => {
    expect(departedOf([a, c], [c], [b], key)).toEqual([b, a]);
    expect(departedOf([a], [a, b], [b], key)).toEqual([]);
  });

  it("keeps a leaving item where it was among the items still listed", () => {
    const shown = (...entries: [{ id: string }, boolean][]) =>
      entries.map(([item, leaving]) => ({ item, leaving }));
    const before = shown([a, false], [b, false], [c, false]);
    expect(placeDeparted(before, [a, c], [b], key)).toEqual(
      shown([a, false], [b, true], [c, false]),
    );
    expect(placeDeparted(before, [b, c], [a], key)).toEqual(
      shown([a, true], [b, false], [c, false]),
    );
    expect(placeDeparted(before, [], [a, b, c], key)).toEqual(
      shown([a, true], [b, true], [c, true]),
    );
    // An item never shown leaves at the end.
    expect(placeDeparted([], [a], [b], key)).toEqual(shown([a, false], [b, true]));
  });
});
