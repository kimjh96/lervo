import { nativeFileSyncInventoryValid } from "../../shared/native-file-sync-contract.mjs";
import { basename, isAbsolute } from "node:path";
import { canonicalDigest } from "../../shared/release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const versionPattern = /^\d+\.\d+\.\d+$/u;
export const maximumArchiveBytes = 1024 * 1024 * 1024;
export const maximumFiles = 100_000;
export const manifestName = "lervo-node-distribution.manifest.json";

export class NodeRuntimeDistributionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "NodeRuntimeDistributionError";
    this.code = code;
  }
}

export function nodeDistributionFailure(code, message, options) {
  throw new NodeRuntimeDistributionError(code, message, options);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

export function nodeDistributionSafePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 1024 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !/[\0\r\n]/u.test(path) &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

export function createNodeDistributionManifest(input) {
  const files = [...input.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const dependencies = [...input.dependencies].sort();
  return {
    schemaVersion: 2,
    kind: "lervo_node_distribution",
    runtimeVersion: input.runtimeVersion,
    platform: input.platform,
    node: ">=22.13",
    entrypoint: "dist/bin.js",
    sbom: { path: "sbom.cdx.json", sha256: input.sbomSha256 },
    files,
    contentDigest: canonicalDigest(files),
    dependencies,
    dependencyDigest: canonicalDigest(dependencies),
    claims: {
      registryRequiredAtInstall: false,
      sourceCheckoutRequiredAtInstall: false,
      containsOperationalSecrets: false,
      serviceActivated: false,
    },
  };
}

export function validateNodeDistributionManifest(value) {
  if (
    !exactKeys(value, [
      "schemaVersion",
      "kind",
      "runtimeVersion",
      "platform",
      "node",
      "entrypoint",
      "sbom",
      "files",
      "contentDigest",
      "dependencies",
      "dependencyDigest",
      "claims",
    ]) ||
    ![1, 2].includes(value.schemaVersion) ||
    value.kind !== "lervo_node_distribution" ||
    !versionPattern.test(value.runtimeVersion) ||
    value.node !== ">=22.13" ||
    value.entrypoint !== "dist/bin.js" ||
    !exactKeys(value.platform, ["os", "arch", "libc"]) ||
    !["darwin", "linux", "win32"].includes(value.platform.os) ||
    !["arm64", "x64"].includes(value.platform.arch) ||
    !["none", "glibc", "musl"].includes(value.platform.libc) ||
    !exactKeys(value.sbom, ["path", "sha256"]) ||
    value.sbom.path !== "sbom.cdx.json" ||
    !digestPattern.test(value.sbom.sha256) ||
    !Array.isArray(value.files) ||
    value.files.length < 3 ||
    value.files.length > maximumFiles ||
    !Array.isArray(value.dependencies) ||
    value.dependencies.length < 1 ||
    value.dependencies.length > 512 ||
    !exactKeys(value.claims, [
      "registryRequiredAtInstall",
      "sourceCheckoutRequiredAtInstall",
      "containsOperationalSecrets",
      "serviceActivated",
    ]) ||
    Object.values(value.claims).some((claim) => claim !== false)
  ) {
    nodeDistributionFailure(
      "node_distribution_manifest_invalid",
      "The Node distribution manifest structure is invalid.",
    );
  }
  const paths = [];
  for (const entry of value.files) {
    if (entry?.kind === "file") {
      if (
        !exactKeys(entry, ["path", "kind", "size", "mode", "sha256"]) ||
        !nodeDistributionSafePath(entry.path) ||
        !Number.isInteger(entry.size) ||
        entry.size < 0 ||
        entry.size > maximumArchiveBytes ||
        !Number.isInteger(entry.mode) ||
        entry.mode < 0 ||
        entry.mode > 0o777 ||
        !digestPattern.test(entry.sha256)
      ) {
        nodeDistributionFailure(
          "node_distribution_manifest_invalid",
          "A Node distribution file manifest is invalid.",
        );
      }
    } else if (entry?.kind === "symlink") {
      if (
        !exactKeys(entry, ["path", "kind", "target"]) ||
        !nodeDistributionSafePath(entry.path) ||
        typeof entry.target !== "string" ||
        entry.target.length < 1 ||
        entry.target.length > 1024 ||
        isAbsolute(entry.target) ||
        /[\0\r\n]/u.test(entry.target)
      ) {
        nodeDistributionFailure(
          "node_distribution_manifest_invalid",
          "A Node distribution symbolic-link manifest is invalid.",
        );
      }
    } else
      nodeDistributionFailure(
        "node_distribution_manifest_invalid",
        "A Node distribution manifest entry kind is invalid.",
      );
    paths.push(entry.path);
  }
  if (
    paths.some((path, index) => index > 0 && paths[index - 1] >= path) ||
    value.contentDigest !== canonicalDigest(value.files) ||
    !nativeFileSyncInventoryValid(
      value.files,
      value.schemaVersion === 2 && value.platform.os === "darwin",
    ) ||
    value.dependencies.some(
      (coordinate, index) =>
        typeof coordinate !== "string" ||
        (index > 0 && value.dependencies[index - 1] >= coordinate),
    ) ||
    value.dependencyDigest !== canonicalDigest(value.dependencies) ||
    !paths.includes("dist/bin.js") ||
    !paths.includes("package.json") ||
    !paths.includes("sbom.cdx.json")
  ) {
    nodeDistributionFailure(
      "node_distribution_manifest_invalid",
      "The Node distribution manifest digest, ordering, or required files are invalid.",
    );
  }
  return value;
}

export function createNodeDistributionArtifact(input) {
  return {
    schemaVersion: 1,
    kind: "lervo_node_distribution_artifact",
    runtimeVersion: input.runtimeVersion,
    platform: input.platform,
    archiveFileName: input.archiveFileName,
    byteCount: input.byteCount,
    sha256: input.sha256,
    manifestSha256: input.manifestSha256,
  };
}

export function validateNodeDistributionArtifact(value) {
  if (
    !exactKeys(value, [
      "schemaVersion",
      "kind",
      "runtimeVersion",
      "platform",
      "archiveFileName",
      "byteCount",
      "sha256",
      "manifestSha256",
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== "lervo_node_distribution_artifact" ||
    !versionPattern.test(value.runtimeVersion) ||
    !exactKeys(value.platform, ["os", "arch", "libc"]) ||
    !["darwin", "linux", "win32"].includes(value.platform.os) ||
    !["arm64", "x64"].includes(value.platform.arch) ||
    !["none", "glibc", "musl"].includes(value.platform.libc) ||
    typeof value.archiveFileName !== "string" ||
    basename(value.archiveFileName) !== value.archiveFileName ||
    !value.archiveFileName.endsWith(".tar.gz") ||
    !Number.isInteger(value.byteCount) ||
    value.byteCount < 1 ||
    value.byteCount > maximumArchiveBytes ||
    !digestPattern.test(value.sha256) ||
    !digestPattern.test(value.manifestSha256)
  ) {
    nodeDistributionFailure(
      "node_distribution_artifact_invalid",
      "The Node distribution artifact descriptor is invalid.",
    );
  }
  return value;
}
