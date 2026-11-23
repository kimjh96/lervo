import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error The catalog compiler is a plain build script without type declarations.
import { compileCatalog } from "../scripts/build-catalog.mjs";
import { chooseLocale, messagesFor } from "../src/i18n/catalog";

const root = join(import.meta.dirname, "..");

/** Every interface source file's text. */
async function sources(directory = join(root, "src")): Promise<string[]> {
  const texts: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) texts.push(...(await sources(path)));
    else if (/\.tsx?$/u.test(entry.name)) texts.push(await readFile(path, "utf8"));
  }
  return texts;
}

describe("the message catalog", () => {
  it("keeps the compiled English catalog current", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lervo-ade-catalog-"));
    try {
      const fresh = join(directory, "en.json");
      await compileCatalog("en", fresh);
      expect(
        await readFile(join(root, "src/i18n/generated/en.json"), "utf8"),
        "Run `pnpm --filter @lervo/ade generate` to recompile the catalog.",
      ).toBe(await readFile(fresh, "utf8"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("names every message with a static ID that the catalog defines and uses every entry", async () => {
    const catalog = Object.keys(
      JSON.parse(await readFile(join(root, "src/i18n/messages.en.json"), "utf8")),
    );
    const text = (await sources()).join("\n");
    const used = new Set(
      [...text.matchAll(/\bid(?:=|: )"([a-z][\w.]*)"/gu)].map((match) => match[1] as string),
    );
    // Provider names come from the core's registry, so no message ID is built at run time.
    const built = [...text.matchAll(/\bid(?:=\{|: )`([^`]*)`/gu)].map((match) => match[1]);
    expect(built).toEqual([]);
    expect([...used].filter((id) => !catalog.includes(id))).toEqual([]);
    expect(catalog.filter((id) => !used.has(id))).toEqual([]);
  });

  it("falls back to English for a locale without a catalog", () => {
    expect(chooseLocale(["ko-KR", "en-US"])).toBe("en");
    expect(chooseLocale(["ko-KR"])).toBe("en");
    expect(Object.keys(messagesFor("ko"))).toContain("start.question");
  });
});
