import { smokeNativeFileSync } from "../../shared/native-file-sync-smoke.mjs";
import { readNativeFileSyncArtifact } from "../../shared/native-file-sync-artifact.mjs";
import { validateNativeFileSyncSbom } from "../../shared/native-file-sync-contract.mjs";
import {
  maximumFiles,
  hubManifestName,
  validateHubDistributionArtifact,
  validateHubDistributionManifest,
  hubDistributionFailure as fail,
  hubDistributionSafePath as safeRelativePath,
} from "./hub-runtime-distribution-contract.mjs";
export {
  createHubDistributionArtifact,
  createHubDistributionManifest,
  validateHubDistributionArtifact,
  validateHubDistributionManifest,
  HubRuntimeDistributionError,
  hubManifestName,
  requiredHubAssetPaths,
} from "./hub-runtime-distribution-contract.mjs";
export { createHubDistributionSbom } from "./runtime-distribution-sbom.mjs";
import { execFile } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

import {
  canonicalJson,
  collectDistributionEntries,
  currentDistributionPlatform,
  sha256File,
} from "./node-runtime-distribution.mjs";
import { smokeHubDistribution } from "./hub-runtime-distribution-smoke.mjs";
import { sha256 } from "../../shared/release-artifact-manifest.mjs";
import { extractTarGzipArchive, tarListingLines } from "../../shared/tar-archive.mjs";
import { distributionEntriesEqual } from "./runtime-distribution-inventory.mjs";

const execFileAsync = promisify(execFile);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
function archiveEntryPath(raw) {
  const path = raw.replace(/^\.\//u, "").replace(/\/$/u, "");
  if (path === "") return null;
  if (!safeRelativePath(path))
    fail("hub_distribution_archive_invalid", "The archive contains an unsafe path.");
  return path;
}

async function inspectArchivePaths(archive) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("tar", ["-tzf", archive], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    }));
  } catch (error) {
    fail(
      "hub_distribution_archive_invalid",
      "The Hub distribution archive listing could not be read.",
      { cause: error },
    );
  }
  const paths = tarListingLines(stdout).map(archiveEntryPath).filter(Boolean);
  if (
    paths.length > maximumFiles * 2 ||
    new Set(paths).size !== paths.length ||
    !paths.includes(hubManifestName)
  ) {
    fail("hub_distribution_archive_invalid", "The Hub distribution archive path set is invalid.");
  }
}

async function parseJsonFile(path, maximumBytes, code) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes)
    fail(code, "The verification source file is unsafe.");
  try {
    const bytes = await readFile(path);
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    fail(code, "The verification source JSON could not be read.");
  }
}

export async function verifyHubDistributionArchive(input) {
  const archive = resolve(input.archive);
  const artifactPath = resolve(input.artifact);
  const [archiveInfo, artifactSource] = await Promise.all([
    lstat(archive),
    parseJsonFile(artifactPath, 64 * 1024, "hub_distribution_artifact_invalid"),
  ]);
  const artifact = validateHubDistributionArtifact(artifactSource.value);
  if (
    !archiveInfo.isFile() ||
    archiveInfo.isSymbolicLink() ||
    archiveInfo.size !== artifact.byteCount ||
    basename(archive) !== artifact.archiveFileName ||
    (await sha256File(archive)) !== artifact.sha256 ||
    !digestPattern.test(input.expectedSha256) ||
    input.expectedSha256 !== artifact.sha256
  ) {
    fail(
      "hub_distribution_digest_mismatch",
      "The Hub distribution archive differs from the declared SHA-256.",
    );
  }
  await inspectArchivePaths(archive);
  const temporaryRoot = await mkdtemp(
    resolve(input.stagingParent ?? tmpdir(), ".lervo-hub-verify-"),
  );
  const payloadRoot = resolve(temporaryRoot, "payload");
  try {
    await mkdir(payloadRoot);
    await extractTarGzipArchive(archive, payloadRoot);
    const manifestSource = await parseJsonFile(
      resolve(payloadRoot, hubManifestName),
      4 * 1024 * 1024,
      "hub_distribution_manifest_invalid",
    );
    const manifest = validateHubDistributionManifest(manifestSource.value);
    if (
      sha256(manifestSource.bytes) !== artifact.manifestSha256 ||
      manifest.runtimeVersion !== artifact.runtimeVersion ||
      canonicalJson(manifest.platform) !== canonicalJson(artifact.platform)
    ) {
      fail(
        "hub_distribution_manifest_mismatch",
        "The archive and content manifest coordinates differ.",
      );
    }
    const actualFiles = await collectDistributionEntries(payloadRoot, new Set([hubManifestName]));
    if (!distributionEntriesEqual(actualFiles, manifest.files, process.platform))
      fail(
        "hub_distribution_content_mismatch",
        "Files inside the archive differ from the content manifest.",
      );
    const sbomBytes = await readFile(resolve(payloadRoot, manifest.sbom.path));
    if (sha256(sbomBytes) !== manifest.sbom.sha256)
      fail(
        "hub_distribution_sbom_mismatch",
        "The Hub distribution SBOM differs from the manifest.",
      );
    const native = await readNativeFileSyncArtifact(resolve(payloadRoot, "dist/native"), {
      required: manifest.schemaVersion === 2 && manifest.platform.os === "darwin",
    });
    validateNativeFileSyncSbom(JSON.parse(sbomBytes.toString("utf8")), native);
    await access(resolve(payloadRoot, manifest.entrypoint), constants.X_OK);
    if (
      input.requireCurrentPlatform &&
      canonicalJson(manifest.platform) !== canonicalJson(currentDistributionPlatform())
    ) {
      fail(
        "hub_distribution_platform_mismatch",
        "The Hub distribution differs from the current operating system, CPU, or libc.",
      );
    }
    if (
      input.smoke &&
      native &&
      canonicalJson(manifest.platform) === canonicalJson(currentDistributionPlatform())
    )
      await smokeNativeFileSync(resolve(payloadRoot, "dist/native"));
    if (input.smoke) {
      if (!(await smokeHubDistribution(payloadRoot, manifest.entrypoint, temporaryRoot)))
        fail("hub_distribution_smoke_failed", "The isolated Hub distribution did not start.");
    }
    return { artifact, manifest, payloadRoot, temporaryRoot };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
