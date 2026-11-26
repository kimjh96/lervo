import { describe, expect, it } from "vitest";

import { layersOf, spaceStep } from "../src/ui/space";

describe("space motion", () => {
  it("reads a place's shown and leaving layers", () => {
    expect(layersOf("")).toEqual({ current: null, leaving: [] });
    expect(layersOf("old- new+")).toEqual({ current: "new", leaving: ["old"] });
  });

  it("opens an empty place, closes it after its last content, and resizes between contents", () => {
    expect(spaceStep("", "content+")).toBe("open");
    expect(spaceStep("content+", "content-")).toBe("close");
    expect(spaceStep("wait+", "wait- result+")).toBe("resize");
    expect(spaceStep("wait- result+", "result+")).toBe("settle");
  });

  it("resizes when content returns while the old content still leaves", () => {
    expect(spaceStep("content-", "content+")).toBe("resize");
    expect(spaceStep("a-", "a- b+")).toBe("resize");
  });

  it("moves nothing when the shown content only changes its own nodes, or nothing is shown", () => {
    expect(spaceStep("content+", "content+")).toBe("none");
    expect(spaceStep("content-", "")).toBe("none");
    expect(spaceStep("", "")).toBe("none");
  });
});
