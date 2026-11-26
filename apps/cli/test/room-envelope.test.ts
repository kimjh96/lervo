import { describe, expect, it } from "vitest";

import { envelopeText, readEnvelope } from "../src/room-envelope.js";

describe("the turn a mention delivers", () => {
  it("names the sender, recalls recent turns within the bound, and reads back as the sender's", () => {
    const recent = Array.from({ length: 12 }, (_, index) => ({
      speaker: index % 2 === 0 ? "Owner" : "Ciel",
      text: `turn ${index}\nwith a second line`,
    }));
    const text = envelopeText({
      from: "Ciel",
      role: "Developer",
      message: "@Arin is Retry-After in seconds?",
      recent,
      reason: "mention",
    });
    expect(
      text.startsWith("[Lervo room] From Ciel (Developer):\n@Arin is Retry-After in seconds?"),
    ).toBe(true);
    expect(text).toContain("- Ciel: turn 11 with a second line");
    expect(text).not.toContain("turn 3");
    expect(text).toContain("your answer returns to Ciel");
    expect(readEnvelope(text)).toEqual({
      from: "Ciel",
      message: "@Arin is Retry-After in seconds?",
    });
  });

  it("marks an answer as one, and reads nothing from the owner's own text", () => {
    const text = envelopeText({
      from: "Arin",
      role: "Researcher",
      message: "Seconds, but the sandbox omits it.",
      recent: [],
      reason: "answer",
    });
    expect(readEnvelope(text)).toEqual({
      from: "Arin",
      message: "Seconds, but the sandbox omits it.",
    });
    expect(readEnvelope("[Lervo room] From nobody\nhi")).toBeNull();
    expect(readEnvelope("Please fix the build.")).toBeNull();
  });
});
