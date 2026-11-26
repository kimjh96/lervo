import { describe, expect, it } from "vitest";

import {
  attachedFiles,
  baseName,
  extension,
  fileSize,
  folderName,
  isAttachablePath,
  isImagePath,
  withAttachedFiles,
} from "../src/features/conversation/model/files";

describe("files in a message", () => {
  it("lists attached paths after the text and reads them back", () => {
    const paths = ["/Users/me/Downloads/report.pdf", "/Users/me/Desktop/signups 2026.csv"];
    const message = withAttachedFiles("Check the numbers", paths);
    expect(message).toBe(
      "Check the numbers\n\nAttached files:\n- /Users/me/Downloads/report.pdf\n- /Users/me/Desktop/signups 2026.csv",
    );
    expect(attachedFiles(message)).toEqual({ text: "Check the numbers", paths });
  });

  it("sends files alone and leaves text without a list whole", () => {
    const alone = withAttachedFiles("", ["/tmp/a.log"]);
    expect(alone).toBe("Attached files:\n- /tmp/a.log");
    expect(attachedFiles(alone)).toEqual({ text: "", paths: ["/tmp/a.log"] });
    expect(withAttachedFiles("Just text", [])).toBe("Just text");
    expect(attachedFiles("Attached files: see below\n- not a path")).toEqual({
      text: "Attached files: see below\n- not a path",
      paths: [],
    });
    // A list in the middle of a message is the person's own text.
    const middle = "Attached files:\n- /tmp/a.log\n\nand more";
    expect(attachedFiles(middle)).toEqual({ text: middle, paths: [] });
  });

  it("names a path's file, folder, and extension", () => {
    expect(baseName("/Users/me/Downloads/report.pdf")).toBe("report.pdf");
    expect(baseName("/Users/me/design-handoff/")).toBe("design-handoff");
    expect(folderName("/Users/me/Downloads/report.pdf")).toBe("Downloads");
    expect(folderName("/report.pdf")).toBe("");
    expect(extension("report.PDF")).toBe("pdf");
    expect(extension(".env")).toBe("");
    expect(extension("Makefile")).toBe("");
  });

  it("tells images and attachable paths apart", () => {
    expect(isImagePath("/Users/me/shot.PNG")).toBe(true);
    expect(isImagePath("/Users/me/photo.heic")).toBe(true);
    expect(isImagePath("/Users/me/report.pdf")).toBe(false);
    expect(isAttachablePath("/Users/me/report.pdf")).toBe(true);
    expect(isAttachablePath("relative/report.pdf")).toBe(false);
    expect(isAttachablePath("/Users/me/two\nlines.txt")).toBe(false);
  });

  it("shows sizes as the chip does", () => {
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(84_000)).toBe("84 KB");
    expect(fileSize(1_200_000)).toBe("1.2 MB");
    expect(fileSize(3_000_000_000)).toBe("3 GB");
  });
});
