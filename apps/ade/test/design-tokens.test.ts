import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error The token renderer is a plain build script without type declarations.
import { renderMotion, renderSizes, renderTokenCss, resolve } from "../scripts/design-tokens.mjs";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFile(join(root, path), "utf8");

describe("design tokens", () => {
  it("keeps the generated stylesheet, motion durations, and sizes current", async () => {
    const tokens = JSON.parse(await read("src/design/tokens.json")) as unknown;
    const hint = "Run `pnpm --filter @lervo/ade generate` to regenerate the design outputs.";
    expect(await read("src/design/generated/tokens.css"), hint).toBe(renderTokenCss(tokens));
    expect(await read("src/design/generated/motion.ts"), hint).toBe(renderMotion(tokens));
    expect(await read("src/design/generated/sizes.ts"), hint).toBe(renderSizes(tokens));
  });

  it("resolves aliases to primitives and keeps primitives out of the stylesheet", async () => {
    const tokens = JSON.parse(await read("src/design/tokens.json")) as unknown;
    expect(resolve(tokens, "{palette.blue.600}")).toBe("#3A64D8");
    expect(resolve(tokens, { fontWeight: "{font.weight.medium}" })).toEqual({ fontWeight: 500 });
    expect(() => resolve(tokens, "{palette.nowhere}")).toThrow("Unknown token alias");
    const css = await read("src/design/generated/tokens.css");
    expect(css).not.toContain("--palette-");
    expect(css).not.toMatch(/\{[a-z]+\./u);
  });

  it("gives every semantic color both modes; primitives have one value", async () => {
    const missing: string[] = [];
    const visit = (group: Record<string, unknown>, path: string[]) => {
      for (const [key, value] of Object.entries(group)) {
        if (key.startsWith("$") || value === null || typeof value !== "object") continue;
        const token = value as {
          $type?: string;
          $extensions?: Record<string, Record<string, unknown>>;
        };
        if (token.$type === "color") {
          const modes = token.$extensions?.["dev.lervo.modes"];
          if (modes?.light === undefined || modes.dark === undefined)
            missing.push([...path, key].join("."));
        } else visit(value as Record<string, unknown>, [...path, key]);
      }
    };
    const { palette: _primitives, ...semantic } = JSON.parse(
      await read("src/design/tokens.json"),
    ) as Record<string, unknown>;
    visit(semantic, []);
    expect(missing).toEqual([]);
  });
});
