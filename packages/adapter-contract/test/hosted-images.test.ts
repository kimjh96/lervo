import { describe, expect, it } from "vitest";

import { imageMark, sendsImages } from "../src/index.js";

const base64 = (hex: string) => Buffer.from(hex.replaceAll(" ", ""), "hex").toString("base64");

describe("hosted images", () => {
  it("reads each format's size from its header", () => {
    const png = base64("89504e470d0a1a0a 0000000d 49484452 00000620 000003d4 0806000000");
    expect(imageMark({ mediaType: "image/png", data: png })).toEqual({
      mediaType: "image/png",
      width: 1568,
      height: 980,
    });
    const gif = base64("474946383961 2003 d403 f70000");
    expect(imageMark({ mediaType: "image/gif", data: gif })).toMatchObject({
      width: 800,
      height: 980,
    });
    // A JPEG's size sits in its first start-of-frame segment, after any other segment.
    const jpeg = base64(
      "ffd8 ffe0 0010 4a46494600010100000100010000 ffc0 0011 08 01e0 0280 03012200021101031101",
    );
    expect(imageMark({ mediaType: "image/jpeg", data: jpeg })).toMatchObject({
      width: 640,
      height: 480,
    });
    const webp = base64("52494646 24000000 57454250 5650384c 0d000000 2f 1f000000");
    expect(imageMark({ mediaType: "image/webp", data: webp })).toMatchObject({
      width: 32,
      height: 1,
    });
  });

  it("keeps only the format of an image whose header does not tell its size", () => {
    expect(imageMark({ mediaType: "image/jpeg", data: base64("ffd8ffd9") })).toEqual({
      mediaType: "image/jpeg",
    });
    expect(imageMark({ mediaType: "image/png", data: base64("89504e47") })).toEqual({
      mediaType: "image/png",
    });
  });

  it("tells a decoder that carries images from one that does not", () => {
    expect(sendsImages({ sendWithImages: () => undefined })).toBe(true);
    expect(sendsImages({ send: () => undefined })).toBe(false);
  });
});
