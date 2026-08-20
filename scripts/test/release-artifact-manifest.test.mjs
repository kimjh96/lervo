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
    private: false,
    access: "public",
    type: "module",
    bin: "dist/bin.js",
    files: ["dist/bin.js"],
  };
  const directDependencies = ["@anthropic-ai/claude-agent-sdk@0.3.226"];
  const bundleFields = {
    entry: "apps/cli/src/bin.ts",
    output: "dist/bin.js",
    workspacePackages: ["@lervo/core@0.1.0"],
    externalImports: ["@anthropic-ai/claude-agent-sdk"],
  };
  const bundle = { ...bundleFields, bundleDigest: canonicalDigest(bundleFields) };
  const files = [{
    path: "dist/bin.js",
    size: 10,
    sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }];
  const portable = ["@anthropic-ai/claude-agent-sdk@0.3.226", "yaml@2.9.0"];
  const platformSpecificFamilies = [{ prefix: "native-", version: "1.0.0" }];
  const manifest = {
    schemaVersion: 2,
    artifact,
    directDependencies,
    bundle,
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
      bundleDigest: bundle.bundleDigest,
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

  it("rejects a private workspace package in the installed closure", () => {
    const manifest = fixture();
    manifest.dependencies.portable[0] = "@lervo/core@0.1.0";
    manifest.dependencies.portableDigest = canonicalDigest(manifest.dependencies.portable);
    manifest.artifactDigest = canonicalDigest({
      artifact: manifest.artifact,
      directDependencies: manifest.directDependencies,
      bundleDigest: manifest.bundle.bundleDigest,
      archiveContentDigest: manifest.archive.contentDigest,
      portableDependenciesDigest: manifest.dependencies.portableDigest,
      platformSpecificFamilies: manifest.dependencies.platformSpecificFamilies,
    });
    assert.throws(
      () => validateReleaseArtifactManifest(manifest),
      { code: "release_artifact_closure_invalid" },
    );
  });

  it("rejects a new external bundle import", () => {
    const manifest = fixture();
    manifest.bundle.externalImports.push("yaml");
    const bundleFields = {
      entry: manifest.bundle.entry,
      output: manifest.bundle.output,
      workspacePackages: manifest.bundle.workspacePackages,
      externalImports: manifest.bundle.externalImports,
    };
    manifest.bundle.bundleDigest = canonicalDigest(bundleFields);
    assert.throws(
      () => validateReleaseArtifactManifest(manifest),
      { code: "release_artifact_bundle_invalid" },
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
