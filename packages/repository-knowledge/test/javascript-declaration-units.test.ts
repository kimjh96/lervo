import { describe, expect, it } from "vitest";

import { extractJavaScriptSymbolSpans } from "../src/javascript-source-units.js";

const declarations = [
  "export type Digests = { names: string[] };",
  "export const KEY_BYTES: number;",
  "export function keyPath(root?: string): string | null;",
  "export class PrivacyKeyError extends Error {}",
].join("\n");

describe("TypeScript declaration files", () => {
  it.each(["types.d.ts", "scripts/perf.d.mts", "lib/index.d.cts"])(
    "extracts ambient declarations from %s",
    (path) => {
      expect(extractJavaScriptSymbolSpans(declarations, path).map((span) => span.locator)).toEqual(
        expect.arrayContaining([
          "declaration:Digests",
          "declaration:KEY_BYTES",
          "declaration:keyPath",
          "declaration:PrivacyKeyError",
        ]),
      );
    },
  );

  it("still rejects a constant without an initializer in an implementation file", () => {
    expect(() =>
      extractJavaScriptSymbolSpans("export const KEY_BYTES: number;", "key.mts"),
    ).toThrow("cannot be extracted safely and completely");
  });

  it("keeps parsing a declaration-named file that holds implementation bodies", () => {
    expect(
      extractJavaScriptSymbolSpans(
        "export function f(a: number) { return a + 1; }",
        "legacy.d.ts",
      ).map((span) => span.locator),
    ).toEqual(["declaration:f"]);
  });
});
