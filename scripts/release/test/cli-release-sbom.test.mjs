import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { createCliReleaseSbom, validateCliReleaseSbom } from "../lib/cli-release-sbom.mjs";
import { createPnpmProductionGraph, pnpmPackageSha512 } from "../lib/pnpm-production-graph.mjs";

const nativeSuffixes = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-arm64-musl",
  "linux-x64",
  "linux-x64-musl",
  "win32-arm64",
  "win32-x64",
];

function integrity(byte) {
  return `sha512-${Buffer.alloc(64, byte).toString("base64")}`;
}

function packageEntry(byte) {
  return { resolution: { integrity: integrity(byte) } };
}

function fixture() {
  const sdkName = "@anthropic-ai/claude-agent-sdk";
  const sdkVersion = "1.0.0";
  const sdkCoordinate = `${sdkName}@${sdkVersion}`;
  const nativeCoordinates = nativeSuffixes.map((suffix) => `${sdkName}-${suffix}@${sdkVersion}`);
  const optionalDependencies = Object.fromEntries(
    nativeSuffixes.map((suffix) => [`${sdkName}-${suffix}`, sdkVersion]),
  );
  const packages = {
    [sdkCoordinate]: packageEntry(1),
    "yaml@2.9.0": packageEntry(2),
    "dev-only@9.0.0": packageEntry(3),
  };
  nativeCoordinates.forEach((coordinate, index) => {
    packages[coordinate] = packageEntry(index + 4);
  });
  const snapshots = {
    [sdkCoordinate]: { optionalDependencies },
    "dev-only@9.0.0": {},
  };
  for (const coordinate of nativeCoordinates) snapshots[coordinate] = {};
  const lockfile = {
    lockfileVersion: "9.0",
    importers: {
      "apps/cli": {
        dependencies: { [sdkName]: { version: sdkVersion } },
        devDependencies: { "dev-only": { version: "9.0.0" } },
      },
    },
    packages,
    snapshots,
  };
  const releaseManifest = {
    artifact: {
      name: "@lervo/cli",
      version: "0.1.0",
      license: "UNLICENSED",
    },
    artifactDigest: `sha256:${"a".repeat(64)}`,
    directDependencies: [sdkCoordinate],
    bundle: {
      bundleDigest: `sha256:${"b".repeat(64)}`,
      workspacePackages: ["@lervo/core@0.1.0"],
      externalPackages: ["yaml@2.9.0"],
    },
    archive: {
      files: [{ path: "dist/bin.js", sha256: `sha256:${"c".repeat(64)}` }],
    },
    dependencies: {
      portable: [sdkCoordinate],
      portableDigest: `sha256:${"d".repeat(64)}`,
      platformSpecificFamilies: [
        {
          prefix: `${sdkName}-`,
          version: sdkVersion,
        },
      ],
    },
  };
  return { lockfile, nativeCoordinates, releaseManifest, sdkCoordinate };
}

describe("pnpm production graph", () => {
  it("walks production roots and optional edges without including dev dependencies", () => {
    const { lockfile, nativeCoordinates, sdkCoordinate } = fixture();
    const graph = createPnpmProductionGraph(lockfile);

    assert.deepEqual(graph.roots, [sdkCoordinate]);
    assert.deepEqual(
      graph.nodes.filter(({ optional }) => !optional).map(({ coordinate }) => coordinate),
      [sdkCoordinate],
    );
    assert.deepEqual(
      graph.nodes.filter(({ optional }) => optional).map(({ coordinate }) => coordinate),
      [...nativeCoordinates].sort(),
    );
    assert.equal(
      graph.nodes.some(({ coordinate }) => coordinate === "dev-only@9.0.0"),
      false,
    );
  });

  it("rejects missing or malformed lockfile integrity", () => {
    const { lockfile, sdkCoordinate } = fixture();
    delete lockfile.packages[sdkCoordinate].resolution.integrity;
    assert.throws(() => pnpmPackageSha512(lockfile, sdkCoordinate), {
      code: "release_sbom_lock_integrity_missing",
    });
  });
});

describe("CLI release SBOM", () => {
  it("binds the artifact, installed graph, bundled workspace and bundled-only package", () => {
    const { lockfile, releaseManifest, sdkCoordinate } = fixture();
    const sbom = createCliReleaseSbom(releaseManifest, lockfile);
    const root = sbom.metadata.component;

    assert.equal(sbom.specVersion, "1.7");
    assert.match(
      sbom.serialNumber,
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    assert.equal(createCliReleaseSbom(releaseManifest, lockfile).serialNumber, sbom.serialNumber);
    assert.equal(Object.hasOwn(sbom.metadata, "timestamp"), false);
    assert.equal(sbom.components.length, 11);
    assert.equal(
      sbom.components.some(({ purl }) => purl === "pkg:npm/dev-only@9.0.0"),
      false,
    );
    const yaml = sbom.components.find(({ purl }) => purl === "pkg:npm/yaml@2.9.0");
    assert.deepEqual(yaml.properties, [
      { name: "lervo:release:bundled", value: "true" },
      { name: "lervo:release:locked", value: "true" },
    ]);
    const rootDependency = sbom.dependencies.find(({ ref }) => ref === root["bom-ref"]);
    assert.deepEqual(rootDependency.dependsOn, [
      "pkg:npm/%40anthropic-ai/claude-agent-sdk@1.0.0",
      "pkg:npm/%40lervo/core@0.1.0",
      "pkg:npm/yaml@2.9.0",
    ]);
    assert.equal(rootDependency.dependsOn.includes(sdkCoordinate), false);
    assert.equal(
      root.properties.find(({ name }) => name === "lervo:release:artifact-digest").value,
      releaseManifest.artifactDigest,
    );
  });

  it("rejects a changed deterministic section", () => {
    const { lockfile, releaseManifest } = fixture();
    const sbom = createCliReleaseSbom(releaseManifest, lockfile);
    sbom.components[0].scope = sbom.components[0].scope === "optional" ? "required" : "optional";
    assert.throws(() => validateCliReleaseSbom(sbom, releaseManifest, lockfile), {
      code: "release_sbom_mismatch",
    });
  });

  it("rejects timestamps even if the remaining inventory is unchanged", () => {
    const { lockfile, releaseManifest } = fixture();
    const sbom = createCliReleaseSbom(releaseManifest, lockfile);
    sbom.metadata.timestamp = "2026-08-20T00:00:00.000Z";
    assert.throws(() => validateCliReleaseSbom(sbom, releaseManifest, lockfile), {
      code: "release_sbom_nondeterministic_metadata",
    });
  });

  it("changes the deterministic serial when the inventory bytes change", () => {
    const { lockfile, releaseManifest, sdkCoordinate } = fixture();
    const before = createCliReleaseSbom(releaseManifest, lockfile);
    lockfile.packages[sdkCoordinate] = packageEntry(63);
    const after = createCliReleaseSbom(releaseManifest, lockfile);

    assert.notEqual(after.serialNumber, before.serialNumber);
  });
});
