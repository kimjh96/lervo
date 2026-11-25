import type { ConversationItem } from "@lervo/session-host-contract";
import { MAX_SENT_IMAGE_CHARACTERS } from "@lervo/session-host-contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";

import { sentImages } from "../src/features/conversation/model/images";
import { ConversationItemView } from "../src/features/conversation/view/renderers";
import { messagesFor } from "../src/i18n/catalog";
import { encodings, fittedSize, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE } from "../src/platform/images/plan";

const render = (item: ConversationItem) =>
  renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: messagesFor("en") },
      createElement(ConversationItemView, { item }),
    ),
  );

describe("images in a message", () => {
  it("scales a pasted image to Claude's longest side and never up", () => {
    expect(fittedSize(3024, 1964)).toEqual({ width: MAX_IMAGE_SIDE, height: 1018 });
    expect(fittedSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("tries PNG first, then JPEG at the fitted size and each smaller step, ending at the floor", () => {
    const steps = [...encodings(3024, 1964)];
    expect(steps[0]).toEqual({ mediaType: "image/png", width: 1568, height: 1018 });
    expect(steps[1]).toMatchObject({ mediaType: "image/jpeg", width: 1568, height: 1018 });
    const last = steps.at(-1)!;
    expect(Math.max(last.width, last.height)).toBe(MIN_IMAGE_SIDE);
    const sides = steps.slice(1).map((step) => Math.max(step.width, step.height));
    expect(sides).toEqual([...sides].sort((a, b) => b - a));
    // A small image keeps its size, so its JPEG step is the last.
    expect([...encodings(200, 100)]).toHaveLength(2);
  });

  it("sends each image's format and bytes, and the bound fits three in one frame", () => {
    expect(sentImages([{ mediaType: "image/jpeg", data: "abcd", width: 10, height: 20 }])).toEqual([
      { mediaType: "image/jpeg", data: "abcd" },
    ]);
    expect(MAX_SENT_IMAGE_CHARACTERS * 3).toBeLessThan(1024 * 1024 - 262_144);
  });

  it("shows the images a message carried as quiet lines in its bubble", () => {
    const html = render({
      kind: "user_message",
      itemId: "i0",
      createdAtMs: 1,
      state: "complete",
      text: "What is wrong here?",
      images: [{ mediaType: "image/png", width: 1568, height: 980 }, { mediaType: "image/jpeg" }],
    });
    expect(html).toContain("What is wrong here?");
    expect(html).toContain("Image · 1568 × 980");
    expect(html).toMatch(/<li>Image<\/li>/u);
    // A message of images alone has no empty paragraph.
    const alone = render({
      kind: "user_message",
      itemId: "i1",
      createdAtMs: 1,
      state: "complete",
      text: "",
      images: [{ mediaType: "image/png", width: 2, height: 1 }],
    });
    expect(alone).not.toContain("<p");
  });
});
