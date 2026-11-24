import { describe, expect, it } from "vitest";

import { departedOf } from "../src/ui/departing";

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
});
