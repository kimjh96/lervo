import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  bundleOutputMetadata,
  bundledPackageRoot,
  isBuiltinModuleSpecifier,
  normalizeBundleMetadataPath,
} from "../lib/cli-release-snapshot.mjs";

describe("CLI release bundle snapshot", () => {
  it("treats explicit node protocol imports as built-ins on every supported Node release", () => {
    const noKnownBuiltins = new Set();

    assert.equal(isBuiltinModuleSpecifier("node:sqlite", noKnownBuiltins), true);
    assert.equal(isBuiltinModuleSpecifier("node:fs", noKnownBuiltins), true);
    assert.equal(isBuiltinModuleSpecifier("sqlite", noKnownBuiltins), false);
    assert.equal(isBuiltinModuleSpecifier("external-package", noKnownBuiltins), false);
  });

  it("uses the runtime list for built-ins without the node protocol", () => {
    assert.equal(isBuiltinModuleSpecifier("fs", new Set(["fs"])), true);
    assert.equal(isBuiltinModuleSpecifier("fs", new Set()), false);
  });

  it("normalizes Windows bundle metadata paths", () => {
    assert.equal(normalizeBundleMetadataPath("apps\\cli\\dist\\bin.js"), "apps/cli/dist/bin.js");
    assert.deepEqual(
      bundleOutputMetadata({
        outputs: {
          "apps\\cli\\dist\\bin.js": { imports: [] },
        },
      }),
      { imports: [] },
    );
  });

  it("finds package roots in portable and Windows metadata paths", () => {
    const portable = "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml/dist/index.js";
    const windows = portable.replaceAll("/", "\\");
    const expected = "node_modules/.pnpm/yaml@2.9.0/node_modules/yaml";

    assert.equal(bundledPackageRoot(portable), expected);
    assert.equal(bundledPackageRoot(windows), expected);
  });
});
