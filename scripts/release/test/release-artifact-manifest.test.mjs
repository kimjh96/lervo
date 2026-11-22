import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  canonicalDigest,
  releaseArchiveFileDifferences,
  releaseArtifactDifferences,
  validateReleaseArtifactManifest,
} from "../../shared/release-artifact-manifest.mjs";

function fixture() {
  const artifact = {
    name: "@lervo/cli",
    version: "0.1.0",
    description: "Lervo CLI for managing AI agent execution and evidence in local repositories",
    keywords: ["ai-agents", "local-first", "orchestration"],
    license: "UNLICENSED",
    repository: null,
    registry: null,
    provenance: null,
    private: false,
    access: "public",
    type: "module",
    node: ">=22.13",
    bin: "dist/bin.js",
    files: ["README.md", "dist/bin.js", "dist/node-runtime.js", "dist/terminal-hook.js"],
  };
  const directDependencies = [
    "@anthropic-ai/claude-agent-sdk@0.3.226",
    "@anthropic-ai/sdk@0.117.1",
    "@modelcontextprotocol/sdk@1.30.0",
    "zod@4.4.3",
  ];
  const bundleFields = {
    entry: "apps/cli/src/bin.ts",
    output: "dist/bin.js",
    workspacePackages: ["@lervo/core@0.1.0"],
    externalPackages: [
      "@babel/parser@7.29.8",
      "ajv@8.20.0",
      "character-entities@2.0.2",
      "decode-named-character-reference@1.3.0",
      "fast-deep-equal@3.1.3",
      "jsonc-parser@3.3.1",
      "mdast-util-from-markdown@2.0.3",
      "mdast-util-to-string@4.0.0",
      "micromark-core-commonmark@2.0.3",
      "micromark-factory-destination@2.0.1",
      "micromark-factory-label@2.0.1",
      "micromark-factory-space@2.0.1",
      "micromark-factory-title@2.0.1",
      "micromark-factory-whitespace@2.0.1",
      "micromark-util-character@2.1.1",
      "micromark-util-chunked@2.0.1",
      "micromark-util-classify-character@2.0.1",
      "micromark-util-combine-extensions@2.0.1",
      "micromark-util-decode-numeric-character-reference@2.0.2",
      "micromark-util-decode-string@2.0.1",
      "micromark-util-encode@2.0.1",
      "micromark-util-html-tag-name@2.0.1",
      "micromark-util-normalize-identifier@2.0.1",
      "micromark-util-resolve-all@2.0.1",
      "micromark-util-sanitize-uri@2.0.1",
      "micromark-util-subtokenize@2.1.0",
      "micromark@4.0.2",
      "nanoid@3.3.18",
      "picocolors@1.1.1",
      "postcss@8.5.26",
      "source-map-js@1.2.1",
      "unist-util-stringify-position@4.0.0",
      "yaml@2.9.0",
    ],
    externalImports: ["@anthropic-ai/claude-agent-sdk"],
  };
  const bundle = { ...bundleFields, bundleDigest: canonicalDigest(bundleFields) };
  const files = [
    {
      path: "README.md",
      size: 20,
      sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    {
      path: "dist/bin.js",
      size: 10,
      sha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    {
      path: "dist/node-runtime.js",
      size: 9,
      sha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
    {
      path: "dist/terminal-hook.js",
      size: 8,
      sha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  ];
  const portable = ["@anthropic-ai/claude-agent-sdk@0.3.226", "yaml@2.9.0"];
  const platformSpecificFamilies = [{ prefix: "native-", version: "1.0.0" }];
  const manifest = {
    schemaVersion: 5,
    artifact,
    directDependencies,
    bundle,
    archive: {
      rootFiles: ["package.json"],
      files,
      fileCount: 5,
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
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_archive_invalid",
    });
  });

  it("rejects a public CLI without the supported Node range", () => {
    const manifest = fixture();
    manifest.artifact.node = ">=20";
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_identity_invalid",
    });
  });

  it("rejects incomplete public package metadata", () => {
    const manifest = fixture();
    manifest.artifact.keywords.pop();
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_identity_invalid",
    });
  });

  it("rejects an archive without the package guide", () => {
    const manifest = fixture();
    manifest.archive.files.shift();
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_archive_invalid",
    });
  });

  it("rejects an incomplete Claude SDK peer set", () => {
    const manifest = fixture();
    manifest.directDependencies.splice(1, 1);
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_dependencies_invalid",
    });
  });

  it("rejects a missing dependency even if a stale artifact digest remains", () => {
    const manifest = fixture();
    manifest.dependencies.portable.pop();
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_closure_invalid",
    });
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
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_closure_invalid",
    });
  });

  it("rejects a new external bundle import", () => {
    const manifest = fixture();
    manifest.bundle.externalImports.push("yaml");
    const bundleFields = {
      entry: manifest.bundle.entry,
      output: manifest.bundle.output,
      workspacePackages: manifest.bundle.workspacePackages,
      externalPackages: manifest.bundle.externalPackages,
      externalImports: manifest.bundle.externalImports,
    };
    manifest.bundle.bundleDigest = canonicalDigest(bundleFields);
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_bundle_invalid",
    });
  });

  it("rejects an unreviewed bundled external package", () => {
    const manifest = fixture();
    manifest.bundle.externalPackages.push("new-package@1.0.0");
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_bundle_invalid",
    });
  });

  it("reports bounded sections instead of copying changed content", () => {
    const expected = fixture();
    const actual = structuredClone(expected);
    actual.artifact.version = "0.1.1";
    actual.archive.files[0].size += 1;
    assert.deepEqual(releaseArtifactDifferences(expected, actual), ["artifact", "archive"]);
    assert.deepEqual(releaseArchiveFileDifferences(expected.archive, actual.archive), [
      "README.md expected=20/sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa " +
        "actual=21/sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  });
});

it.each([6, 7, 8])(
  "binds the exact native set in schema %s while retaining schema 5 reads",
  async (schemaVersion) => {
    const { cliReleaseFilesForSchema } = await import("../../shared/cli-release-files.mjs");
    const cliReleaseFiles = cliReleaseFilesForSchema(schemaVersion),
      cliNativeFiles = cliReleaseFiles.filter((path) => path.startsWith("dist/native/"));
    const { releaseArtifactDigest } = await import("../../shared/release-artifact-manifest.mjs");
    const manifest = fixture();
    manifest.schemaVersion = schemaVersion;
    manifest.artifact.files = [...cliReleaseFiles];
    manifest.archive.files.push(
      ...cliNativeFiles.map((path) => ({ path, size: 128, sha256: `sha256:${"a".repeat(64)}` })),
    );
    if (schemaVersion === 8)
      manifest.archive.files.push({
        path: "dist/repository-runtime.js",
        size: 256,
        sha256: `sha256:${"b".repeat(64)}`,
      });
    manifest.archive.files.sort((a, b) => (a.path < b.path ? -1 : 1));
    const rebind = () => {
      manifest.archive.fileCount = manifest.archive.files.length + 1;
      manifest.archive.contentDigest = canonicalDigest(manifest.archive.files);
      manifest.artifactDigest = releaseArtifactDigest(manifest);
    };
    rebind();
    assert.equal(validateReleaseArtifactManifest(manifest), manifest);
    manifest.archive.files = manifest.archive.files.filter(
      (entry) => entry.path !== cliNativeFiles[0],
    );
    rebind();
    assert.throws(() => validateReleaseArtifactManifest(manifest), {
      code: "release_artifact_archive_invalid",
    });
    assert.equal(validateReleaseArtifactManifest(fixture()).schemaVersion, 5);
  },
);

it.each([9, 10, 11])(
  "binds all graph members in schema %s even when outer digests are recomputed",
  async (schemaVersion) => {
    const { cliGraphPackageFiles, legacyCliGraphPackageFiles, cliNativeFiles } =
      await import("../../shared/cli-release-files.mjs");
    const { sha256, releaseArtifactDigest } =
      await import("../../shared/release-artifact-manifest.mjs");
    const manifest = fixture();
    manifest.schemaVersion = schemaVersion;
    manifest.artifact.files = [
      ...(schemaVersion >= 10 ? cliGraphPackageFiles : legacyCliGraphPackageFiles),
    ];
    const graph = [
      "repository-runtime-core.js",
      "repository-runtime-fallback.cjs",
      "repository-runtime.js",
    ].map((name) => ({ name, size: 128, sha256: sha256(name) }));
    const bytes = Buffer.from(
      JSON.stringify({ schemaVersion: 1, entry: "repository-runtime.js", files: graph }, null, 2) +
        "\n",
    );
    manifest.archive.files.push(
      ...(schemaVersion >= 10
        ? [{ path: "dist/terminal-hook-launcher.mjs", size: 128, sha256: sha256("launcher") }]
        : []),
      ...(schemaVersion === 11
        ? [{ path: "LICENSE", size: 11358, sha256: sha256("license") }]
        : []),
      ...cliNativeFiles.map((path) => ({ path, size: 128, sha256: sha256(path) })),
      ...graph.map(({ name, ...entry }) => ({ path: `dist/${name}`, ...entry })),
      { path: "dist/repository-runtime.json", size: bytes.length, sha256: sha256(bytes) },
    );
    const rebind = (value) => {
      value.archive.files.sort((a, b) => (a.path < b.path ? -1 : 1));
      value.archive.fileCount = value.archive.files.length + 1;
      value.archive.contentDigest = canonicalDigest(value.archive.files);
      value.artifactDigest = releaseArtifactDigest(value);
    };
    rebind(manifest);
    assert.equal(validateReleaseArtifactManifest(manifest), manifest);
    // Schema 11 requires the repository LICENSE in the archive; earlier schemas refuse it.
    const withoutLicense = structuredClone(manifest);
    if (schemaVersion === 11)
      withoutLicense.archive.files = withoutLicense.archive.files.filter(
        (entry) => entry.path !== "LICENSE",
      );
    else withoutLicense.archive.files.push({ path: "LICENSE", size: 11358, sha256: sha256("l") });
    rebind(withoutLicense);
    assert.throws(() => validateReleaseArtifactManifest(withoutLicense), {
      code: "release_artifact_archive_invalid",
    });
    if (schemaVersion === 11) {
      const oversized = structuredClone(manifest);
      oversized.archive.files.find((entry) => entry.path === "LICENSE").size = 64 * 1024 + 1;
      rebind(oversized);
      assert.throws(() => validateReleaseArtifactManifest(oversized), {
        code: "release_artifact_archive_invalid",
      });
    }
    for (const member of graph) {
      for (const mutation of ["missing", "hash", "size"]) {
        const changed = structuredClone(manifest),
          path = `dist/${member.name}`;
        if (mutation === "missing")
          changed.archive.files = changed.archive.files.filter((entry) => entry.path !== path);
        else
          changed.archive.files.find((entry) => entry.path === path)[
            mutation === "hash" ? "sha256" : "size"
          ] = mutation === "hash" ? sha256("changed") : 129;
        rebind(changed);
        assert.throws(() => validateReleaseArtifactManifest(changed), {
          code: "release_artifact_archive_invalid",
        });
      }
    }
  },
);
