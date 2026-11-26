import type { Choices, ConversationItem } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import {
  answersOf,
  laneOf,
  openQuestions,
  toggled,
} from "../src/features/conversation/model/questions";

const choices: Choices = {
  requestId: "req_1",
  questions: [
    {
      question: "Which color?",
      header: "Color",
      multiSelect: false,
      options: [
        { label: "Red", description: "" },
        { label: "Blue", description: "" },
      ],
    },
    {
      question: "Which sizes?",
      header: "Sizes",
      multiSelect: true,
      options: [
        { label: "S", description: "" },
        { label: "M", description: "" },
      ],
    },
  ],
};

function question(itemId: string, withChoices = true): ConversationItem {
  return {
    kind: "question",
    itemId,
    createdAtMs: 1,
    state: "complete",
    text: "Which color?",
    ...(withChoices ? { choices } : {}),
  };
}

function said(itemId: string): ConversationItem {
  return { kind: "user_message", itemId, createdAtMs: 2, state: "complete", text: "Blue" };
}

describe("questions with choices", () => {
  it("names the lead's items and a joined agent's by their session", () => {
    expect(laneOf("i4")).toBe("");
    expect(laneOf("ses_arin:i4")).toBe("ses_arin");
  });

  it("keeps a question open while it is the last item of its session", () => {
    expect(openQuestions([said("i1"), question("i2")], true)).toEqual(new Set(["i2"]));
    // An answer, or the person's own reply, closes it.
    expect(openQuestions([question("i2"), said("i3")], true)).toEqual(new Set());
    // A joined agent's question waits beside the lead's later items.
    expect(openQuestions([question("ses_arin:i2"), said("i5")], true)).toEqual(
      new Set(["ses_arin:i2"]),
    );
    // A question without choices, or a window short of the end, opens none.
    expect(openQuestions([question("i2", false)], true)).toEqual(new Set());
    expect(openQuestions([question("i2")], false)).toEqual(new Set());
  });

  it("sends each question's labels by its text once every question has one", () => {
    expect(answersOf(choices, new Map([[0, ["Blue"]]]))).toBeNull();
    expect(
      answersOf(
        choices,
        new Map([
          [0, ["Blue"]],
          [1, ["S", "M"]],
        ]),
      ),
    ).toEqual({ "Which color?": "Blue", "Which sizes?": "S, M" });
  });

  it("chooses one label, or toggles several where the question allows them", () => {
    expect(toggled(["Red"], "Blue", false)).toEqual(["Blue"]);
    expect(toggled(["S"], "M", true)).toEqual(["S", "M"]);
    expect(toggled(["S", "M"], "S", true)).toEqual(["M"]);
  });
});
