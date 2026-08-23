import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createHubDistributionArtifact,
  createHubDistributionManifest,
  createHubDistributionSbom,
  requiredHubAssetPaths,
  validateHubDistributionArtifact,
  validateHubDistributionManifest,
} from "../lib/hub-runtime-distribution.mjs";

function manifestFixture() {
  const files = [
    { path: "README.md", kind: "file", size: 1, mode: 0o644, sha256: `sha256:${"a".repeat(64)}` },
    { path: "dist/bin.js", kind: "file", size: 1, mode: 0o755, sha256: `sha256:${"b".repeat(64)}` },
    { path: "package.json", kind: "file", size: 1, mode: 0o644, sha256: `sha256:${"c".repeat(64)}` },
    { path: "sbom.cdx.json", kind: "file", size: 1, mode: 0o644, sha256: `sha256:${"d".repeat(64)}` },
    ...requiredHubAssetPaths.map((path) => ({ path, kind: "file", size: 1, mode: 0o644, sha256: `sha256:${"e".repeat(64)}` })),
  ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return createHubDistributionManifest({
    runtimeVersion: "0.1.0",
    platform: { os: "linux", arch: "x64", libc: "glibc" },
    files,
    sbomSha256: files[3].sha256,
  });
}

describe("standalone Hub runtime distribution contract", () => {
  it("accepts a self-contained Hub manifest with no registry or service claim", () => {
    const manifest = manifestFixture();
    assert.equal(validateHubDistributionManifest(manifest), manifest);
    assert.equal(manifest.claims.registryRequiredAtInstall, false);
    assert.equal(manifest.claims.serviceActivated, false);
  });

  it("rejects modified content and stronger runtime claims", () => {
    const changed = manifestFixture();
    changed.files[0].size += 1;
    assert.throws(() => validateHubDistributionManifest(changed), { code: "hub_distribution_manifest_invalid" });
    const claimed = manifestFixture();
    claimed.claims.serviceActivated = true;
    assert.throws(() => validateHubDistributionManifest(claimed), { code: "hub_distribution_manifest_invalid" });
    const withoutAsset = manifestFixture();
    withoutAsset.files = withoutAsset.files.filter((entry) => entry.path !== "assets/trace.html");
    assert.throws(() => validateHubDistributionManifest(withoutAsset), { code: "hub_distribution_manifest_invalid" });
  });

  it("binds an artifact descriptor to one safe archive and digest", () => {
    const artifact = createHubDistributionArtifact({
      runtimeVersion: "0.1.0",
      platform: { os: "linux", arch: "x64", libc: "glibc" },
      archiveFileName: "lervo-hub-linux-x64.tar.gz",
      byteCount: 123,
      sha256: `sha256:${"e".repeat(64)}`,
      manifestSha256: `sha256:${"f".repeat(64)}`,
    });
    assert.equal(validateHubDistributionArtifact(artifact), artifact);
    artifact.archiveFileName = "../escaped.tar.gz";
    assert.throws(() => validateHubDistributionArtifact(artifact), { code: "hub_distribution_artifact_invalid" });
  });

  it("creates an application-only CycloneDX graph for the fully bundled Hub", () => {
    const sbom = createHubDistributionSbom("0.1.0", `sha256:${"a".repeat(64)}`);
    assert.deepEqual(sbom.components, []);
    assert.deepEqual(sbom.dependencies, [{ ref: "pkg:generic/lervo-hub@0.1.0", dependsOn: [] }]);
  });
});
