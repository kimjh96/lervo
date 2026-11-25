import type { ConversationItem } from "@lervo/session-host-contract";
import { MAX_SENT_IMAGE_CHARACTERS } from "@lervo/session-host-contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";

import { ImageCache, imageCache, sentImages } from "../src/features/conversation/model/images";
import { ConversationImagesProvider } from "../src/features/conversation/view/ConversationImages";
import { shownSize } from "../src/features/conversation/view/MessageImages";
import { ConversationItemView } from "../src/features/conversation/view/renderers";
import { messagesFor } from "../src/i18n/catalog";
import { encodings, fittedSize, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE } from "../src/platform/images/plan";

const render = (item: ConversationItem) =>
  renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: "en", messages: messagesFor("en") },
      createElement(
        ConversationImagesProvider,
        { read: () => Promise.reject(new Error("not kept")) },
        createElement(ConversationItemView, { item }),
      ),
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

  it("shows a message's images in its bubble, read once, or as a quiet tile when not kept", () => {
    const id = "a".repeat(64);
    imageCache.put(id, "data:image/png;base64,iVBORw0KGgo=");
    const html = render({
      kind: "user_message",
      itemId: "i0",
      createdAtMs: 1,
      state: "complete",
      text: "What is wrong here?",
      images: [
        { mediaType: "image/png", width: 1568, height: 980, imageId: id },
        { mediaType: "image/jpeg" },
      ],
    });
    expect(html).toContain("What is wrong here?");
    // The kept image draws from the cache, named for screen readers, never as visible text.
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).toContain('alt="Image 1 of 2, 1568 × 980"');
    expect(html).not.toContain(">Image 1 of 2");
    // An image without an identity shows as a quiet tile.
    expect(html).toContain('aria-label="Image 2 of 2"');
    // A message of images alone has no paragraph.
    const alone = render({
      kind: "user_message",
      itemId: "i1",
      createdAtMs: 1,
      state: "complete",
      text: "",
      images: [{ mediaType: "image/png", width: 2, height: 1, imageId: id }],
    });
    expect(alone).not.toContain("<p");
  });

  it("shows a lone image in its own shape within the bubble's bound", () => {
    expect(shownSize({ mediaType: "image/png", width: 1568, height: 980 })).toEqual({
      width: 280,
      height: 175,
    });
    expect(shownSize({ mediaType: "image/png", width: 720, height: 1280 })).toEqual({
      width: 113,
      height: 200,
    });
    expect(shownSize({ mediaType: "image/png", width: 100, height: 50 })).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("keeps the most recently used images within the cache's bound", () => {
    const cache = new ImageCache(10);
    cache.put("a", "12345");
    cache.put("b", "12345");
    cache.get("a");
    cache.put("c", "12345");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("12345");
    expect(cache.get("c")).toBe("12345");
  });
});
