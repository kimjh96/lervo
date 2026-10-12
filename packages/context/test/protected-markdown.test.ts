import { expect, it } from "vitest";
import { protectedMarkdownDigests } from "../src/protected-markdown.js";
const digest = (value: string) => protectedMarkdownDigests(Buffer.from(value));
it("preserves exact code, inline code, and quotations independently of surrounding language", () => {
  expect(digest("설명 `id`\n\n> 인용\n\n```ts\n1\n```\n")).toEqual(
    digest("English `id`\n\n```ts\n1\n```\n\n> 인용\n"),
  );
  expect(digest("`id` `id`")).toHaveLength(2);
  expect(digest("`id`")).not.toEqual(digest("`ID`"));
});
it("rejects invalid UTF-8 and oversized artifacts", () => {
  expect(() => protectedMarkdownDigests(new Uint8Array([255]))).toThrow();
  expect(() => protectedMarkdownDigests(new Uint8Array(1048577))).toThrow();
});
