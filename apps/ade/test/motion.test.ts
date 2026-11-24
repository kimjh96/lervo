import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error The motion check is a plain build script without type declarations.
import { checkMotion, motionViolations } from "../scripts/check-motion.mjs";

describe("the motion check", () => {
  it("finds no violation in the interface's stylesheets", async () => {
    expect(await checkMotion(join(import.meta.dirname, ".."))).toEqual([]);
  });

  it("rejects an arrival or a leaving that could pop in or drop out", () => {
    const css = `
      .a { animation: global(lervo-appear) var(--motion-duration-change) var(--motion-easing-standard); }
      .b { animation: lervo-leave var(--motion-duration-exit) var(--motion-easing-exit) forwards; }
      .c { animation: global(lervo-arrive) var(--motion-duration-enter) var(--motion-easing-standard); }
      .d { animation: global(lervo-leave) var(--motion-duration-leave) var(--motion-easing-standard) forwards; }
    `;
    expect(motionViolations(css, "x.css")).toEqual([
      "x.css: an arrival runs over something other than enter on the standard easing",
      "x.css: a leaving runs over something other than leave on the standard easing",
    ]);
  });

  it("rejects literal durations and easings, layout transitions, and layout keyframes", () => {
    const css = `
      .a { transition: width 200ms ease; }
      .b { animation: grow var(--motion-duration-enter) linear; }
      @keyframes grow { from { height: 0; } to { opacity: 1; } }
      .ok { transition: background-color var(--motion-duration-change) var(--motion-easing-standard); }
    `;
    expect(motionViolations(css, "x.css")).toEqual([
      "x.css: transition uses a duration that is not a motion token",
      "x.css: transition uses an easing that is not a motion token",
      "x.css: transition moves width",
      "x.css: animation uses an easing that is not a motion token",
      "x.css: @keyframes grow animates height",
    ]);
  });

  it("names only patterns of the motion catalog in motion comments", async () => {
    const root = join(import.meta.dirname, "..");
    const catalog = await readFile(
      join(root, "../../docs/specifications/execution/product-surfaces/ade-motion.md"),
      "utf8",
    );
    const patterns = new Set(
      [...catalog.matchAll(/^\| ([A-Z][^|]*?) +\|/gmu)].map((match) => match[1]),
    );
    const named: string[] = [];
    for (const directory of ["src/features", "src/app"])
      for (const entry of await readdir(join(root, directory), { recursive: true }))
        if (String(entry).endsWith(".tsx")) {
          const text = await readFile(join(root, directory, String(entry)), "utf8");
          for (const match of text.matchAll(/motion:\s*([^*]+?)\s*\*\//gu))
            named.push(match[1] ?? "");
        }
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !patterns.has(name))).toEqual([]);
  });
});
