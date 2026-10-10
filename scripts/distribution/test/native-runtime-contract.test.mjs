import { expect, it } from "vitest";
import {
  nativeRuntimeNames,
  validateNativeRuntimeSbom,
} from "../../shared/native-runtime-contract.mjs";
import {
  createHubDistributionSbom,
  createNodeDistributionSbom,
} from "../lib/runtime-distribution-sbom.mjs";
import * as hub from "../lib/hub-runtime-distribution-contract.mjs";
import * as node from "../lib/node-runtime-distribution-contract.mjs";
import { canonicalDigest, sha256 } from "../../shared/release-artifact-manifest.mjs";
import { nativeFileSyncFixture } from "./native-file-sync-fixture.mjs";

function artifact() {
  const { binary, manifest } = nativeFileSyncFixture();
  const pair = (name) => ({
    manifest,
    files: {
      [name + "-darwin.node"]: binary,
      [name + ".json"]: Buffer.from(JSON.stringify(manifest)),
    },
  });
  const sync = pair("file-sync"),
    cas = pair("cas-io");
  return { sync, cas, files: { ...sync.files, ...cas.files } };
}
it.each(["hub", "node"])("binds all four %s SBOM hashes and edges", (kind) => {
  const native = artifact();
  const generate = () =>
    kind === "hub"
      ? createHubDistributionSbom("0.1.0", sha256("bundle"), native)
      : createNodeDistributionSbom("0.1.0", ["package@1.0.0"], sha256("bundle"), native);
  expect(() => validateNativeRuntimeSbom(generate(), native)).not.toThrow();
  for (const mutation of [
    "missing-edge",
    "duplicate-edge",
    "missing-node",
    "changed-hash",
    "extra-component",
  ]) {
    const sbom = generate(),
      ref = "lervo:native-cas:cas-io.json";
    if (mutation === "missing-edge")
      sbom.dependencies[0].dependsOn = sbom.dependencies[0].dependsOn.filter(
        (value) => value !== ref,
      );
    if (mutation === "duplicate-edge") sbom.dependencies[0].dependsOn.push(ref);
    if (mutation === "missing-node")
      sbom.dependencies = sbom.dependencies.filter((entry) => entry.ref !== ref);
    if (mutation === "changed-hash")
      sbom.components.find((entry) => entry["bom-ref"] === ref).hashes[0].content = "0".repeat(64);
    if (mutation === "extra-component")
      sbom.components.push({ type: "file", "bom-ref": "lervo:native-cas:extra" });
    expect(() => validateNativeRuntimeSbom(sbom, native)).toThrow("sbom_invalid");
  }
});
it.each(["hub", "node"])(
  "requires the exact schema-3 %s native inventory only on Darwin",
  (kind) => {
    const owner = kind === "hub" ? hub : node,
      prefix = kind === "hub" ? "Hub" : "Node";
    const paths = [
      "README.md",
      "package.json",
      "sbom.cdx.json",
      "dist/bin.js",
      ...(kind === "hub" ? hub.requiredHubAssetPaths : []),
    ];
    const files = paths.map((path) => ({
      path,
      kind: "file",
      size: 1,
      mode: 0o644,
      sha256: sha256("fixture"),
    }));
    const make = (os) =>
      owner[`create${prefix}DistributionManifest`]({
        runtimeVersion: "0.1.0",
        platform: { os, arch: "arm64", libc: os === "linux" ? "glibc" : "none" },
        files: structuredClone(files),
        sbomSha256: sha256("sbom"),
        dependencies: ["package@1.0.0"],
      });
    const validate = owner[`validate${prefix}DistributionManifest`];
    expect(() => validate(make("linux"))).not.toThrow();
    expect(() => validate(make("darwin"))).toThrow();
    files.push(
      ...nativeRuntimeNames.map((name) => ({
        path: "dist/native/" + name,
        kind: "file",
        size: 128,
        mode: 0o644,
        sha256: sha256("fixture"),
      })),
    );
    expect(() => validate(make("darwin"))).not.toThrow();
    expect(() => validate(make("linux"))).toThrow();
    for (const mutation of ["missing", "symlink", "oversize", "extra"]) {
      const manifest = make("darwin"),
        entry = manifest.files.find((file) => file.path === "dist/native/cas-io.json");
      if (mutation === "missing") manifest.files = manifest.files.filter((file) => file !== entry);
      if (mutation === "symlink") {
        delete entry.size;
        delete entry.mode;
        delete entry.sha256;
        entry.kind = "symlink";
        entry.target = "file-sync.json";
      }
      if (mutation === "oversize") entry.size = 4097;
      if (mutation === "extra") manifest.files.push({ ...entry, path: "dist/native/extra" });
      manifest.files.sort((a, b) => (a.path < b.path ? -1 : 1));
      manifest.contentDigest = canonicalDigest(manifest.files);
      expect(() => validate(manifest)).toThrow();
    }
  },
);
