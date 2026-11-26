import { access, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearProjectMark,
  inspectMarkImage,
  markAssetPath,
  PROJECT_PROFILE_PATH,
  ProjectProfileError,
  readProjectMark,
  readProjectProfile,
  renameProject,
  setProjectMark,
  validDisplayName,
} from "../src/index.js";

const roots: string[] = [];

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-profile-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A PNG header with the given size; the rest of the file is irrelevant to the check. */
function png(width: number, height: number, padding = 32): Uint8Array {
  const bytes = new Uint8Array(24 + padding);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function code(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof ProjectProfileError ? error.code : "other";
  }
  return undefined;
}

describe("project profile", () => {
  it("validates display names", () => {
    expect(validDisplayName("  argo web  ")).toBe("argo web");
    expect(validDisplayName("할 일 앱")).toBe("할 일 앱");
    expect(code(() => validDisplayName(""))).toBe("project_name_invalid");
    expect(code(() => validDisplayName("a\nb"))).toBe("project_name_invalid");
    expect(code(() => validDisplayName("x".repeat(81)))).toBe("project_name_invalid");
  });

  it("accepts PNG, JPEG, and WebP marks within the bound and refuses the rest", () => {
    expect(inspectMarkImage(png(256, 256)).mediaType).toBe("image/png");
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40]);
    expect(inspectMarkImage(jpeg).mediaType).toBe("image/jpeg");
    const webp = new Uint8Array(30);
    webp.set([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0, 0, 0,
      0, 0x2f,
    ]);
    new DataView(webp.buffer).setUint32(21, (63 & 0x3fff) | ((63 & 0x3fff) << 14), true);
    expect(inspectMarkImage(webp).mediaType).toBe("image/webp");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(code(() => inspectMarkImage(svg))).toBe("project_mark_invalid");
    expect(code(() => inspectMarkImage(png(8, 8)))).toBe("project_mark_invalid");
    expect(code(() => inspectMarkImage(png(2048, 64)))).toBe("project_mark_invalid");
    expect(code(() => inspectMarkImage(png(64, 64, 600 * 1024)))).toBe("project_mark_invalid");
  });

  it("renames without touching the manifest and keeps the mark", async () => {
    const root = await project();
    await writeFile(resolve(root, ".lervo/project.yaml"), "name: argo\n");
    expect(await readProjectProfile(root)).toEqual({ state: "absent" });
    const { before, after } = await renameProject(root, "argo", "Argo Web");
    expect(before.displayName).toBe("argo");
    expect(after).toEqual({
      schemaVersion: 1,
      kind: "lervo_project_profile",
      displayName: "Argo Web",
      mark: null,
    });
    expect(await readFile(resolve(root, ".lervo/project.yaml"), "utf8")).toBe("name: argo\n");
  });

  it("stores a mark once by hash, replaces it, and clears it", async () => {
    const root = await project();
    const first = await setProjectMark(root, "argo", png(64, 64));
    const mark = first.after.mark!;
    expect(markAssetPath(mark)).toMatch(/^\.lervo\/assets\/[0-9a-f]{64}\.png$/u);
    expect((await readProjectMark(root))?.mark).toEqual(mark);
    const second = await setProjectMark(root, "argo", png(128, 128));
    await expect(access(resolve(root, markAssetPath(mark)))).rejects.toThrow();
    expect(second.after.displayName).toBe("argo");
    await clearProjectMark(root, "argo");
    await expect(access(resolve(root, markAssetPath(second.after.mark!)))).rejects.toThrow();
    expect(await readProjectMark(root)).toBeNull();
  });

  it("treats an invalid profile as none and never rewrites it on read", async () => {
    const root = await project();
    await writeFile(resolve(root, PROJECT_PROFILE_PATH), '{"schemaVersion":2}');
    expect(await readProjectProfile(root)).toEqual({ state: "invalid" });
    expect(await readFile(resolve(root, PROJECT_PROFILE_PATH), "utf8")).toBe('{"schemaVersion":2}');
  });
});
