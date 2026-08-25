import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "vitest";

import { normalizeGeneratedText, normalizeGeneratedTextFile } from "../lib/generated-text.mjs";

describe("generated text portability", () => {
  it("normalizes Windows line endings without changing existing LF bytes", () => {
    assert.equal(normalizeGeneratedText("first\r\nsecond\r\n"), "first\nsecond\n");
    assert.equal(normalizeGeneratedText("first\nsecond\n"), "first\nsecond\n");
  });

  it("normalizes a generated file in place", async () => {
    const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-generated-text-"));
    const fixturePath = resolve(fixtureRoot, "bundle.js");
    try {
      await writeFile(fixturePath, "#!/usr/bin/env node\r\nconsole.log('ok');\r\n", "utf8");
      await normalizeGeneratedTextFile(fixturePath);
      assert.equal(
        await readFile(fixturePath, "utf8"),
        "#!/usr/bin/env node\nconsole.log('ok');\n",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
