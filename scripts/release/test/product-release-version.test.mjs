import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, it } from "vitest";

import { readProductReleaseVersion } from "../../distribution/lib/product-release-version.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeCliManifest(manifest) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-product-release-version-"));
  roots.push(root);
  await mkdir(resolve(root, "apps/cli"), { recursive: true });
  await writeFile(resolve(root, "apps/cli/package.json"), JSON.stringify(manifest));
  return root;
}

describe("product release version", () => {
  it("uses the public CLI version as the standalone runtime release coordinate", async () => {
    const root = await writeCliManifest({
      name: "@lervo/cli",
      version: "0.8.2",
      private: false,
    });

    assert.equal(await readProductReleaseVersion(root), "0.8.2");
  });

  it("rejects private, unrelated, or non-release manifests", async () => {
    for (const manifest of [
      { name: "@lervo/cli", version: "0.8.2", private: true },
      { name: "@lervo/hub-runtime", version: "0.8.2", private: false },
      { name: "@lervo/cli", version: "next", private: false },
    ]) {
      const root = await writeCliManifest(manifest);
      await assert.rejects(() => readProductReleaseVersion(root), {
        message: "The public Lervo CLI manifest does not contain a stable release version.",
      });
    }
  });
});
