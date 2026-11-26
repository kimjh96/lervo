import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { atomicWrite, workforceStateFits } from "../src/workforce-state-io.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("the workforce state bound on write", () => {
  it("refuses a record past 2 MiB before any byte changes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-workforce-size-"));
    roots.push(root);
    const path = resolve(root, "asn.json");
    await writeFile(path, "{}\n", { mode: 0o600 });
    const oversized = `${JSON.stringify({ expectedPaths: [`src/${"x".repeat(2 * 1024 * 1024)}`] })}\n`;
    await expect(atomicWrite(path, oversized)).rejects.toMatchObject({
      code: "workforce_write_failed",
    });
    expect(await readFile(path, "utf8")).toBe("{}\n");
    await atomicWrite(path, '{"ok":true}\n');
    expect(await readFile(path, "utf8")).toBe('{"ok":true}\n');
  });

  it("measures bytes, not characters, against a bound", () => {
    expect(workforceStateFits("é".repeat(10), 20)).toBe(true);
    expect(workforceStateFits("é".repeat(11), 20)).toBe(false);
  });
});
