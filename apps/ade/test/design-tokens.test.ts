import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error The token renderer is a plain build script without type declarations.
import { renderTerminalThemes, renderTokenCss } from "../scripts/design-tokens.mjs";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFile(join(root, path), "utf8");

describe("design tokens", () => {
  it("keeps the generated stylesheet and terminal themes current", async () => {
    const tokens = JSON.parse(await read("src/design/tokens.json")) as unknown;
    const hint = "Run `pnpm --filter @lervo/ade generate` to regenerate the design outputs.";
    expect(await read("src/design/generated/tokens.css"), hint).toBe(renderTokenCss(tokens));
    expect(await read("src/design/generated/terminal-theme.ts"), hint).toBe(
      renderTerminalThemes(tokens),
    );
  });

  it("gives every color both modes", async () => {
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
    visit(JSON.parse(await read("src/design/tokens.json")) as Record<string, unknown>, []);
    expect(missing).toEqual([]);
  });
});
