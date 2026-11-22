import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error The catalog compiler is a plain build script without type declarations.
import { compileCatalog } from "../scripts/build-catalog.mjs";
import { chooseLocale, messagesFor } from "../src/i18n/catalog";

const root = join(import.meta.dirname, "..");

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

  it("falls back to English for a locale without a catalog", () => {
    expect(chooseLocale(["ko-KR", "en-US"])).toBe("en");
    expect(chooseLocale(["ko-KR"])).toBe("en");
    expect(Object.keys(messagesFor("ko"))).toContain("start.question");
  });
});
