import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error The literal check is a plain build script without type declarations.
import {
  checkLiterals,
  componentViolations,
  stylesheetViolations,
} from "../scripts/check-literals.mjs";

describe("the design value check", () => {
  it("finds no literal design value in the interface", async () => {
    expect(await checkLiterals(join(import.meta.dirname, ".."))).toEqual([]);
  });

  it("rejects literal colors, sizes, type values, and opacities, and allows the exceptions", () => {
    const css = `
      .a { color: #fff; width: 34px; font-weight: 500; opacity: 0.45; max-width: 80%; }
      .b { border: 1px solid var(--color-border-subtle); margin: 0; width: 100%; line-height: 1; }
      .c { mask-image: linear-gradient(to top, transparent 0, #000 var(--space-24)); }
      @media (width < 760px) { .d { gap: var(--space-8); } }
      @media (width < 500px) { .e { gap: var(--space-8); } }
      @keyframes in { from { opacity: 0; } }
      .f { opacity: 0; } .f:hover { opacity: 1; }
    `;
    expect(stylesheetViolations(css, "x.css", new Set(["760px"]))).toEqual([
      "x.css: @media uses 500px, which is not a layout breakpoint",
      "x.css: color uses a literal color",
      "x.css: width uses 34px, which is not a token",
      "x.css: font-weight uses 500, which is not a token",
      "x.css: opacity uses 0.45, which is not a token",
      "x.css: max-width uses 80%, which is not a token",
    ]);
  });

  it("rejects sizes passed to components as numbers", () => {
    expect(componentViolations(`<ArrowUpIcon size={16} />`, "x.tsx")).toEqual([
      "x.tsx: a size is passed as a number instead of a token",
    ]);
    expect(componentViolations(`<ArrowUpIcon size="lg" />`, "x.tsx")).toEqual([]);
  });
});
