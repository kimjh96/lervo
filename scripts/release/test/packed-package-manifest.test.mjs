import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, it } from "vitest";

import {
  canonicalPackageManifestJson,
  expectedPackedPackageManifest,
} from "../lib/packed-package-manifest.mjs";
import { readNpmTarballEntries } from "../lib/npm-tarball-entries.mjs";
import { readWorkspacePackageVersions } from "../lib/workspace-package-versions.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("packed package manifest", () => {
  it("resolves workspace ranges and keeps every other field", () => {
    const versions = new Map([
      ["@lervo/core", "0.1.0"],
      ["@lervo/cas", "0.2.0"],
      ["@lervo/context", "0.3.0"],
    ]);
    const source = {
      name: "@lervo/cli",
      scripts: { build: "tsc" },
      dependencies: { zod: "4.4.3", "@lervo/cas": "workspace:^" },
      devDependencies: {
        "@lervo/core": "workspace:*",
        "@lervo/context": "workspace:~",
        "@lervo/unknown": "workspace:*",
        esbuild: "0.28.2",
      },
    };
    assert.deepEqual(expectedPackedPackageManifest(source, versions), {
      name: "@lervo/cli",
      scripts: { build: "tsc" },
      dependencies: { zod: "4.4.3", "@lervo/cas": "^0.2.0" },
      devDependencies: {
        "@lervo/core": "0.1.0",
        "@lervo/context": "~0.3.0",
        "@lervo/unknown": "workspace:*",
        esbuild: "0.28.2",
      },
    });
    assert.equal(source.devDependencies["@lervo/core"], "workspace:*");
    assert.equal(
      canonicalPackageManifestJson({ b: { y: 1, x: [2, { d: 1, c: 0 }] }, a: 0 }),
      '{"a":0,"b":{"x":[2,{"c":0,"d":1}],"y":1}}\n',
    );
  });

  it("matches the manifest pnpm writes when packing the CLI, whatever its key order", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-packed-manifest-"));
    roots.push(root);
    const expected = canonicalPackageManifestJson(
      expectedPackedPackageManifest(
        JSON.parse(await readFile(resolve(repositoryRoot, "apps/cli/package.json"), "utf8")),
        await readWorkspacePackageVersions(repositoryRoot),
      ),
    );
    const report = JSON.parse(
      execFileSync(
        "pnpm",
        ["--filter", "@lervo/cli", "pack", "--pack-destination", root, "--json"],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
        },
      ),
    );
    const packed = readNpmTarballEntries(await readFile(report.filename)).get("package.json");
    assert.equal(canonicalPackageManifestJson(JSON.parse(packed.toString("utf8"))), expected);
  });
});
