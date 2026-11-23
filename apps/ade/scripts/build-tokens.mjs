// Writes the generated design outputs. A test fails when the committed outputs are stale.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderMotion, renderTerminalThemes, renderTokenCss } from "./design-tokens.mjs";

const root = resolve(import.meta.dirname, "..");
const tokens = JSON.parse(await readFile(resolve(root, "src/design/tokens.json"), "utf8"));
await writeFile(resolve(root, "src/design/generated/tokens.css"), renderTokenCss(tokens));
await writeFile(
  resolve(root, "src/design/generated/terminal-theme.ts"),
  renderTerminalThemes(tokens),
);
await writeFile(resolve(root, "src/design/generated/motion.ts"), renderMotion(tokens));
