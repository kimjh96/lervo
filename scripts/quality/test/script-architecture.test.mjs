import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectScriptArchitecture } from "../lib/script-architecture.mjs";

const temporaryRoots = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-script-architecture-"));
  temporaryRoots.push(root);
  await mkdir(resolve(root, "scripts/quality"), { recursive: true });
  await writeFile(
    resolve(root, "package.json"),
    `${JSON.stringify({ scripts: { check: "node scripts/quality/check.mjs" } }, null, 2)}\n`,
  );
  await writeFile(resolve(root, "scripts/quality/check.mjs"), "export const valid = true;\n");
  return root;
}

describe("repository script architecture", () => {
  it("accepts the repository's owned domains and dependency direction", async () => {
    const result = await inspectScriptArchitecture({
      repositoryRoot: resolve(import.meta.dirname, "../../.."),
    });
    expect(result.issues).toEqual([]);
    expect(result.moduleCount).toBeGreaterThan(500);
  });

  it("rejects root clutter and reverse domain dependencies", async () => {
    const root = await fixture();
    await mkdir(resolve(root, "scripts/release"), { recursive: true });
    await writeFile(resolve(root, "scripts/loose.mjs"), "export const loose = true;\n");
    await writeFile(
      resolve(root, "scripts/quality/check.mjs"),
      'import "../release/private.mjs";\nexport const command = "scripts/release/missing.mjs";\n',
    );
    await writeFile(resolve(root, "scripts/release/private.mjs"), "export const value = 1;\n");

    const result = await inspectScriptArchitecture({ repositoryRoot: root });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "scripts/loose.mjs is an unowned root script artifact.",
        "scripts/quality/check.mjs crosses the disallowed quality->release boundary.",
        "scripts/quality/check.mjs references missing repository script scripts/release/missing.mjs.",
      ]),
    );
  });
});
