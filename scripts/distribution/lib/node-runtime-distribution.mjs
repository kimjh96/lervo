import { readRuntimeModuleArtifact } from "../../../packages/runtime-security/dist/index.js";
import { validateRepositoryRuntimeSbom } from "../../shared/repository-runtime-contract.mjs";
import { smokeNativeCas } from "../../shared/native-cas-smoke.mjs";
import { smokeNativeFileSync } from "../../shared/native-file-sync-smoke.mjs";
import { readNativeRuntimeArtifact } from "../../shared/native-runtime-artifact.mjs";
import { validateNativeRuntimeSbom } from "../../shared/native-runtime-contract.mjs";
import {
  NodeRuntimeDistributionError,
  maximumFiles,
  maximumArchiveBytes,
  manifestName,
  validateNodeDistributionArtifact,
  validateNodeDistributionManifest,
  nodeDistributionFailure as fail,
  nodeDistributionSafePath as safeRelativePath,
} from "./node-runtime-distribution-contract.mjs";
export {
  createNodeDistributionArtifact,
  createNodeDistributionManifest,
  validateNodeDistributionArtifact,
  validateNodeDistributionManifest,
  NodeRuntimeDistributionError,
  manifestName,
  maximumArchiveBytes,
} from "./node-runtime-distribution-contract.mjs";
export { createNodeDistributionSbom } from "./runtime-distribution-sbom.mjs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { collectInstalledPackages } from "../../shared/release-dependency-closure.mjs";
import { canonicalJson, sha256 } from "../../shared/release-artifact-manifest.mjs";
import { extractTarGzipArchive, tarListingLines } from "../../shared/tar-archive.mjs";
import { distributionEntriesEqual } from "./runtime-distribution-inventory.mjs";

const execFileAsync = promisify(execFile);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
function platformLibc() {
  if (process.platform !== "linux") return "none";
  return process.report?.getReport()?.header?.glibcVersionRuntime === undefined ? "musl" : "glibc";
}

export function currentDistributionPlatform() {
  return { os: process.platform, arch: process.arch, libc: platformLibc() };
}

export function nativeClaudePackageName(platform) {
  if (platform.os === "darwin" && ["arm64", "x64"].includes(platform.arch)) {
    return `@anthropic-ai/claude-agent-sdk-darwin-${platform.arch}`;
  }
  if (platform.os === "linux" && ["arm64", "x64"].includes(platform.arch)) {
    return `@anthropic-ai/claude-agent-sdk-linux-${platform.arch}${platform.libc === "musl" ? "-musl" : ""}`;
  }
  if (platform.os === "win32" && ["arm64", "x64"].includes(platform.arch)) {
    return `@anthropic-ai/claude-agent-sdk-win32-${platform.arch}`;
  }
  return null;
}

function inside(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== "..");
}

async function walk(root, directory, entries, excluded) {
  const children = await readdir(directory, { withFileTypes: true });
  for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = resolve(directory, child.name);
    const path = relative(root, absolute).split(sep).join("/");
    if (excluded.has(path)) continue;
    if (!safeRelativePath(path))
      fail("node_distribution_path_invalid", "A path inside the distribution is unsafe.");
    const info = await lstat(absolute);
    if (info.isDirectory()) {
      await walk(root, absolute, entries, excluded);
      continue;
    }
    if (info.isSymbolicLink()) {
      const target = await readlink(absolute);
      if (
        isAbsolute(target) ||
        /[\0\r\n]/u.test(target) ||
        !inside(root, resolve(dirname(absolute), target))
      ) {
        fail(
          "node_distribution_symlink_invalid",
          "A distribution symbolic link points outside the distribution root.",
        );
      }
      entries.push({ path, kind: "symlink", target });
      continue;
    }
    if (!info.isFile() || info.size > maximumArchiveBytes) {
      fail(
        "node_distribution_file_invalid",
        "The distribution contains a non-regular entry or an oversized file.",
      );
    }
    const bytes = await readFile(absolute);
    entries.push({
      path,
      kind: "file",
      size: bytes.length,
      mode: info.mode & 0o777,
      sha256: sha256(bytes),
    });
    if (entries.length > maximumFiles)
      fail("node_distribution_limit_exceeded", "The distribution file count exceeds the limit.");
  }
}

export async function collectDistributionEntries(root, excluded = new Set()) {
  const entries = [];
  await walk(resolve(root), resolve(root), entries, excluded);
  return entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

export async function installedDependencyCoordinates(root) {
  const packages = await collectInstalledPackages(resolve(root, "node_modules"));
  return [...packages.keys()].sort();
}

function archiveEntryPath(raw) {
  const path = raw.replace(/^\.\//u, "").replace(/\/$/u, "");
  if (path === "") return null;
  if (!safeRelativePath(path))
    fail("node_distribution_archive_invalid", "The archive contains an unsafe path.");
  return path;
}

async function inspectArchivePaths(archive) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("tar", ["-tzf", archive], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30_000,
    }));
  } catch (error) {
    fail(
      "node_distribution_archive_invalid",
      "The Node distribution archive listing could not be read safely.",
      { cause: error },
    );
  }
  const paths = tarListingLines(stdout).map(archiveEntryPath).filter(Boolean);
  if (
    paths.length > maximumFiles * 2 ||
    new Set(paths).size !== paths.length ||
    !paths.includes(manifestName)
  ) {
    fail("node_distribution_archive_invalid", "The Node distribution archive path set is invalid.");
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

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

export async function verifyNodeDistributionArchive(input) {
  const archive = resolve(input.archive);
  const artifactPath = resolve(input.artifact);
  const [archiveInfo, artifactSource] = await Promise.all([
    lstat(archive),
    parseJsonFile(artifactPath, 64 * 1024, "node_distribution_artifact_invalid"),
  ]);
  const artifact = validateNodeDistributionArtifact(artifactSource.value);
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
      "node_distribution_digest_mismatch",
      "The Node distribution archive differs from the declared SHA-256.",
    );
  }
  await inspectArchivePaths(archive);
  const temporaryRoot = await mkdtemp(
    resolve(input.stagingParent ?? tmpdir(), ".lervo-node-verify-"),
  );
  const payloadRoot = resolve(temporaryRoot, "payload");
  try {
    await mkdir(payloadRoot);
    await extractTarGzipArchive(archive, payloadRoot);
    const manifestSource = await parseJsonFile(
      resolve(payloadRoot, manifestName),
      64 * 1024 * 1024,
      "node_distribution_manifest_invalid",
    );
    const manifest = validateNodeDistributionManifest(manifestSource.value);
    if (
      sha256(manifestSource.bytes) !== artifact.manifestSha256 ||
      manifest.runtimeVersion !== artifact.runtimeVersion ||
      canonicalJson(manifest.platform) !== canonicalJson(artifact.platform)
    ) {
      fail(
        "node_distribution_manifest_mismatch",
        "The archive and content manifest coordinates differ.",
      );
    }
    const actualFiles = await collectDistributionEntries(payloadRoot, new Set([manifestName]));
    if (!distributionEntriesEqual(actualFiles, manifest.files, process.platform))
      fail(
        "node_distribution_content_mismatch",
        "Files inside the archive differ from the content manifest.",
      );
    const sbomBytes = await readFile(resolve(payloadRoot, manifest.sbom.path));
    if (sha256(sbomBytes) !== manifest.sbom.sha256)
      fail(
        "node_distribution_sbom_mismatch",
        "The Node distribution SBOM differs from the manifest.",
      );
    const dependencies = await installedDependencyCoordinates(payloadRoot);
    if (canonicalJson(dependencies) !== canonicalJson(manifest.dependencies))
      fail(
        "node_distribution_dependency_mismatch",
        "The installed dependency closure differs from the manifest.",
      );
    const nativePackage = nativeClaudePackageName(manifest.platform);
    if (nativePackage === null || !dependencies.includes(`${nativePackage}@0.3.226`))
      fail(
        "node_distribution_native_runtime_mismatch",
        "The Claude native runtime for the target platform is missing.",
      );
    const native = await readNativeRuntimeArtifact(resolve(payloadRoot, "dist/native"), {
      required: manifest.schemaVersion >= 2 && manifest.platform.os === "darwin",
      casRequired: manifest.schemaVersion >= 3 && manifest.platform.os === "darwin",
    });
    validateNativeRuntimeSbom(JSON.parse(sbomBytes.toString("utf8")), native);
    if (manifest.schemaVersion >= 4)
      validateRepositoryRuntimeSbom(
        JSON.parse(sbomBytes.toString("utf8")),
        manifest.schemaVersion >= 5
          ? (await readRuntimeModuleArtifact(resolve(payloadRoot, "dist"))).hash
          : await sha256File(resolve(payloadRoot, "dist/repository-runtime.js")),
        manifest.schemaVersion >= 5 ? "inventory" : "single_file",
      );
    await access(resolve(payloadRoot, manifest.entrypoint), constants.X_OK);
    if (
      input.requireCurrentPlatform &&
      canonicalJson(manifest.platform) !== canonicalJson(currentDistributionPlatform())
    ) {
      fail(
        "node_distribution_platform_mismatch",
        "The Node distribution differs from the current operating system, CPU, or libc.",
      );
    }
    if (
      input.smoke &&
      native &&
      canonicalJson(manifest.platform) === canonicalJson(currentDistributionPlatform())
    ) {
      await smokeNativeFileSync(resolve(payloadRoot, "dist/native"));
      if (native.cas) await smokeNativeCas(resolve(payloadRoot, "dist/native"));
    }
    if (input.smoke) {
      const result = await execFileAsync(
        process.execPath,
        [resolve(payloadRoot, manifest.entrypoint)],
        {
          cwd: payloadRoot,
          encoding: "utf8",
          maxBuffer: 64 * 1024,
          timeout: 10_000,
        },
      ).catch((error) => ({
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        code: error.code,
      }));
      if (
        result.stdout !== "" ||
        result.stderr !==
          "Lervo Node error (invalid_arguments): Usage: lervo-node --config <config.json> | --check-config <config.json>\n"
      ) {
        fail(
          "node_distribution_smoke_failed",
          "The isolated Node distribution entrypoint did not start as expected.",
        );
      }
    }
    return { artifact, manifest, payloadRoot, temporaryRoot };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function ensureExecutable(path) {
  await chmod(path, 0o755);
  await access(path, constants.X_OK);
}

export async function safeOutputPath(path) {
  if (!isAbsolute(path) || /[\0\r\n]/u.test(path))
    fail("node_distribution_arguments_invalid", "The output path must be a safe absolute path.");
  const parent = dirname(resolve(path));
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    fail(
      "node_distribution_arguments_invalid",
      "The output parent must be a real directory, not a symbolic link.",
    );
  }
  const canonicalPath = resolve(await realpath(parent), basename(path));
  try {
    await lstat(canonicalPath);
    fail("node_distribution_output_exists", "Existing output will not be overwritten.");
  } catch (error) {
    if (error instanceof NodeRuntimeDistributionError) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  return canonicalPath;
}

export { canonicalJson };
