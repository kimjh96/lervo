import { nativeRuntimeInventoryValid } from "../../shared/native-runtime-contract.mjs";
import { nativeFileSyncInventoryValid } from "../../shared/native-file-sync-contract.mjs";
import { basename, isAbsolute } from "node:path";
import { canonicalDigest } from "../../shared/release-artifact-manifest.mjs";
import { maximumArchiveBytes } from "./node-runtime-distribution-contract.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const versionPattern = /^\d+\.\d+\.\d+$/u;
export const maximumFiles = 1_024;
export const hubManifestName = "lervo-hub-distribution.manifest.json";
export const requiredHubAssetPaths = [
  "assets/control.html",
  "assets/control.css",
  "assets/control-api.js",
  "assets/control-coordinates.js",
  "assets/control.js",
  "assets/control-render.js",
  "assets/trace.html",
  "assets/trace-base.css",
  "assets/trace-workspace.css",
  "assets/trace-responsive.css",
  "assets/trace-graph.css",
  "assets/trace-api.js",
  "assets/trace-labels.js",
  "assets/trace-graph.js",
  "assets/trace-graph-controller.js",
  "assets/trace-navigation.js",
  "assets/trace-pagination.js",
  "assets/trace-render.js",
  "assets/trace.js",
];

export class HubRuntimeDistributionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "HubRuntimeDistributionError";
    this.code = code;
  }
}

export function hubDistributionFailure(code, message, options) {
  throw new HubRuntimeDistributionError(code, message, options);
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
  );
}

export function hubDistributionSafePath(path) {
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

export function createHubDistributionManifest(input) {
  const files = [...input.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return {
    schemaVersion: 3,
    kind: "lervo_hub_distribution",
    runtimeVersion: input.runtimeVersion,
    platform: input.platform,
    node: ">=22.13",
    entrypoint: "dist/bin.js",
    sbom: { path: "sbom.cdx.json", sha256: input.sbomSha256 },
    files,
    contentDigest: canonicalDigest(files),
    claims: {
      registryRequiredAtInstall: false,
      sourceCheckoutRequiredAtInstall: false,
      containsOperationalSecrets: false,
      serviceActivated: false,
    },
  };
}

export function validateHubDistributionManifest(value) {
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
      "claims",
    ]) ||
    ![1, 2, 3].includes(value.schemaVersion) ||
    value.kind !== "lervo_hub_distribution" ||
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
    value.files.length < 4 ||
    value.files.length > maximumFiles ||
    !exactKeys(value.claims, [
      "registryRequiredAtInstall",
      "sourceCheckoutRequiredAtInstall",
      "containsOperationalSecrets",
      "serviceActivated",
    ]) ||
    Object.values(value.claims).some((claim) => claim !== false)
  ) {
    hubDistributionFailure(
      "hub_distribution_manifest_invalid",
      "The Hub distribution manifest structure is invalid.",
    );
  }
  const paths = [];
  for (const entry of value.files) {
    if (entry?.kind === "file") {
      if (
        !exactKeys(entry, ["path", "kind", "size", "mode", "sha256"]) ||
        !hubDistributionSafePath(entry.path) ||
        !Number.isInteger(entry.size) ||
        entry.size < 0 ||
        entry.size > maximumArchiveBytes ||
        !Number.isInteger(entry.mode) ||
        entry.mode < 0 ||
        entry.mode > 0o777 ||
        !digestPattern.test(entry.sha256)
      ) {
        hubDistributionFailure(
          "hub_distribution_manifest_invalid",
          "A Hub distribution file manifest is invalid.",
        );
      }
    } else if (entry?.kind === "symlink") {
      if (
        !exactKeys(entry, ["path", "kind", "target"]) ||
        !hubDistributionSafePath(entry.path) ||
        typeof entry.target !== "string" ||
        entry.target.length < 1 ||
        entry.target.length > 1024 ||
        isAbsolute(entry.target) ||
        /[\0\r\n]/u.test(entry.target)
      ) {
        hubDistributionFailure(
          "hub_distribution_manifest_invalid",
          "A Hub distribution symbolic-link manifest is invalid.",
        );
      }
    } else
      hubDistributionFailure(
        "hub_distribution_manifest_invalid",
        "A Hub distribution manifest entry kind is invalid.",
      );
    paths.push(entry.path);
  }
  if (
    paths.some((path, index) => index > 0 && paths[index - 1] >= path) ||
    value.contentDigest !== canonicalDigest(value.files) ||
    !(value.schemaVersion === 3
      ? value.platform.os === "darwin"
        ? nativeRuntimeInventoryValid(value.files, true)
        : !value.files.some((entry) => entry.path.startsWith("dist/native/"))
      : nativeFileSyncInventoryValid(
          value.files,
          value.schemaVersion === 2 && value.platform.os === "darwin",
        )) ||
    !paths.includes("dist/bin.js") ||
    !paths.includes("package.json") ||
    !paths.includes("README.md") ||
    !paths.includes("sbom.cdx.json") ||
    requiredHubAssetPaths.some((path) => !paths.includes(path))
  ) {
    hubDistributionFailure(
      "hub_distribution_manifest_invalid",
      "The Hub distribution manifest digest, ordering, or required files are invalid.",
    );
  }
  return value;
}

export function createHubDistributionArtifact(input) {
  return {
    schemaVersion: 1,
    kind: "lervo_hub_distribution_artifact",
    runtimeVersion: input.runtimeVersion,
    platform: input.platform,
    archiveFileName: input.archiveFileName,
    byteCount: input.byteCount,
    sha256: input.sha256,
    manifestSha256: input.manifestSha256,
  };
}

export function validateHubDistributionArtifact(value) {
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
    value.kind !== "lervo_hub_distribution_artifact" ||
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
    hubDistributionFailure(
      "hub_distribution_artifact_invalid",
      "The Hub distribution artifact descriptor is invalid.",
    );
  }
  return value;
}
