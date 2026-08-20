import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  canonicalDigest,
  releaseArtifactDifferences,
  validateReleaseArtifactManifest,
} from "../lib/release-artifact-manifest.mjs";

function fixture() {
  const artifact = {
    name: "@lervo/cli",
    version: "0.1.0",
    private: true,
    type: "module",
    bin: "dist/bin.js",
    main: "dist/main.js",
    types: "dist/main.d.ts",
    files: ["dist/**/*.js", "dist/**/*.d.ts"],
  };
  const directDependencies = ["@lervo/core@0.1.0", "yaml@2.9.0"];
  const files = [{
    path: "dist/bin.js",
    size: 10,
    sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }];
  const portable = ["@lervo/core@0.1.0", "yaml@2.9.0"];
  const platformSpecificFamilies = [{ prefix: "native-", version: "1.0.0" }];
  const manifest = {
    schemaVersion: 1,
    artifact,
    directDependencies,
    archive: {
      rootFiles: ["package.json"],
      files,
      fileCount: 2,
      contentDigest: canonicalDigest(files),
    },
    dependencies: {
      portable,
      portableDigest: canonicalDigest(portable),
      platformSpecificFamilies,
    },
  };
  return {
    ...manifest,
    artifactDigest: canonicalDigest({
      artifact,
      directDependencies,
      archiveContentDigest: manifest.archive.contentDigest,
      portableDependenciesDigest: manifest.dependencies.portableDigest,
      platformSpecificFamilies,
    }),
  };
}

describe("release artifact manifest", () => {
  it("accepts a self-consistent bounded manifest", () => {
    const manifest = fixture();
    assert.equal(validateReleaseArtifactManifest(manifest), manifest);
  });

  it("rejects a changed file without a matching content digest", () => {
    const manifest = fixture();
    manifest.archive.files[0].size += 1;
    assert.throws(
      () => validateReleaseArtifactManifest(manifest),
      { code: "release_artifact_archive_invalid" },
    );
  });

  it("rejects a missing dependency even if a stale artifact digest remains", () => {
    const manifest = fixture();
    manifest.dependencies.portable.pop();
    assert.throws(
      () => validateReleaseArtifactManifest(manifest),
      { code: "release_artifact_closure_invalid" },
    );
  });

  it("reports bounded sections instead of copying changed content", () => {
    const expected = fixture();
    const actual = structuredClone(expected);
    actual.artifact.version = "0.1.1";
    actual.archive.files[0].size += 1;
    assert.deepEqual(releaseArtifactDifferences(expected, actual), ["artifact", "archive"]);
  });
});
