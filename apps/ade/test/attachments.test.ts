import { MAX_SENT_IMAGES } from "@lervo/session-host-contract";
import { describe, expect, it, vi } from "vitest";

import { type AttachmentPorts, Attachments } from "../src/features/conversation/model/attachments";
import { MAX_ATTACHED_FILES } from "../src/features/conversation/model/files";
import { type AttachedFile, ImageFailure, type PreparedImage } from "../src/ports";

const prepared: PreparedImage = { mediaType: "image/png", data: "AAAA", width: 2, height: 1 };
const file = (path: string, more: Partial<AttachedFile> = {}): AttachedFile => ({
  path,
  name: path.split("/").at(-1) ?? path,
  size: 10,
  directory: false,
  exists: true,
  ...more,
});

/** Ports whose image preparation and clipboard answer what each test says. */
function ports(input: {
  prepare?: () => Promise<PreparedImage>;
  pasted?: AttachedFile[];
  described?: AttachedFile[];
}) {
  const released: string[] = [];
  let previews = 0;
  const fake: AttachmentPorts = {
    images: { prepare: input.prepare ?? (async () => prepared) },
    files: {
      pasted: async () => input.pasted ?? [],
      describe: async () => input.described ?? [],
      readImage: async () => new Blob(["png"], { type: "image/png" }),
    },
    preview: () => {
      previews += 1;
      const url = `blob:${previews}`;
      return { url, release: () => released.push(url) };
    },
  };
  return { fake, released };
}

const png = (name = "shot.png") => new File(["png"], name, { type: "image/png" });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("what waits in an input card", () => {
  it("shows a pasted image at once, then the prepared image, and releases its preview", async () => {
    let finish: (image: PreparedImage) => void = () => undefined;
    const { fake, released } = ports({
      prepare: () => new Promise<PreparedImage>((resolve) => (finish = resolve)),
    });
    const card = new Attachments(fake, { key: "reply:1" });
    card.paste("reply:1", [png()], true);
    await settle();
    expect(card.held("reply:1").images).toEqual([{ id: 1, preview: "blob:1" }]);
    finish(prepared);
    await settle();
    expect(card.held("reply:1").images[0]?.image).toEqual(prepared);
    expect(released).toEqual(["blob:1"]);
    expect(card.take("reply:1")).toEqual({ images: [prepared], files: [] });
    expect(card.held("reply:1")).toEqual({ images: [], files: [] });
  });

  it("drops an image the system cannot prepare and says why", async () => {
    const { fake } = ports({
      prepare: async () => Promise.reject(new ImageFailure("image_too_large")),
    });
    const card = new Attachments(fake, { key: "reply:1" });
    card.paste("reply:1", [png()], true);
    await settle();
    await settle();
    expect(card.held("reply:1").images).toEqual([]);
    expect(card.store.getState().notice).toBe("image_too_large");
  });

  it("refuses an image past the limit", async () => {
    const card = new Attachments(ports({}).fake, {
      key: "reply:1",
      images: Array.from({ length: MAX_SENT_IMAGES }, () => prepared),
    });
    card.paste("reply:1", [png()], true);
    await settle();
    expect(card.held("reply:1").images).toHaveLength(MAX_SENT_IMAGES);
    expect(card.store.getState().notice).toBe("tooMany");
  });

  it("keeps each dropped file once, within the limit, and an image as a path when images do not go", async () => {
    const paths = Array.from({ length: MAX_ATTACHED_FILES + 1 }, (_, index) => `/w/f${index}.ts`);
    const { fake } = ports({
      described: [file("/w/shot.png"), file("/w/shot.png"), ...paths.map((path) => file(path))],
    });
    const card = new Attachments(fake, { key: "reply:1" });
    card.drop("reply:1", [], false);
    await settle();
    const kept = card.held("reply:1").files.map((item) => item.file.path);
    expect(kept[0]).toBe("/w/shot.png");
    expect(kept).toHaveLength(MAX_ATTACHED_FILES);
    expect(new Set(kept).size).toBe(kept.length);
    expect(card.store.getState().notice).toBe("tooManyFiles");
  });

  it("reads the clipboard's files for a pasted image when the session takes no images", async () => {
    const empty = new Attachments(ports({ pasted: [] }).fake, { key: "reply:1" });
    empty.paste("reply:1", [png()], false);
    await settle();
    expect(empty.store.getState().notice).toBe("unsupported");
    const copied = new Attachments(ports({ pasted: [file("/w/shot.png")] }).fake, {
      key: "reply:1",
    });
    copied.paste("reply:1", [png()], false);
    await settle();
    expect(copied.held("reply:1").files.map((item) => item.file.path)).toEqual(["/w/shot.png"]);
  });

  it("changes nothing when work ends after the card turned to another conversation", async () => {
    let finish: (image: PreparedImage) => void = () => undefined;
    const prepare = vi.fn(() => new Promise<PreparedImage>((resolve) => (finish = resolve)));
    const card = new Attachments(ports({ prepare }).fake, { key: "reply:1" });
    card.paste("reply:1", [png()], true);
    await settle();
    card.follow("reply:2");
    finish(prepared);
    await settle();
    expect(card.held("reply:2")).toEqual({ images: [], files: [] });
    expect(card.held("reply:1").images[0]?.image).toBeUndefined();
  });

  it("puts back what a failed send took, before what was added since", async () => {
    const { fake } = ports({ described: [file("/w/later.ts")] });
    const card = new Attachments(fake, { key: "reply:1", files: [file("/w/first.ts")] });
    const taken = card.take("reply:1");
    card.drop("reply:1", ["/w/later.ts"], true);
    await settle();
    card.restore("reply:1", taken);
    expect(card.held("reply:1").files.map((item) => item.file.path)).toEqual([
      "/w/first.ts",
      "/w/later.ts",
    ]);
  });
});
