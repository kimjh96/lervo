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

import { collectInstalledPackages } from "./release-dependency-closure.mjs";
import { canonicalDigest, canonicalJson, sha256 } from "./release-artifact-manifest.mjs";

const execFileAsync = promisify(execFile);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const versionPattern = /^\d+\.\d+\.\d+$/u;
const maximumArchiveBytes = 1024 * 1024 * 1024;
const maximumFiles = 100_000;
const manifestName = "lervo-node-distribution.manifest.json";

export class NodeRuntimeDistributionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "NodeRuntimeDistributionError";
    this.code = code;
  }
}

function fail(code, message, options) {
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

function safeRelativePath(path) {
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

function packageIdentity(coordinate) {
  const separator = coordinate.lastIndexOf("@");
  const fullName = coordinate.slice(0, separator);
  const version = coordinate.slice(separator + 1);
  if (!fullName || !version)
    fail("node_distribution_dependency_invalid", "The dependency coordinates are invalid.");
  const [group, name] = fullName.startsWith("@") ? fullName.split("/") : [undefined, fullName];
  const purl =
    group === undefined
      ? `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
      : `pkg:npm/${encodeURIComponent(group)}/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  return { fullName, version, ...(group === undefined ? {} : { group }), name, purl };
}

export function createNodeDistributionSbom(version, coordinates, bundleSha256) {
  const rootRef = `pkg:generic/lervo-node@${version}`;
  return {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": rootRef,
        name: "lervo-node",
        version,
        hashes: [{ alg: "SHA-256", content: bundleSha256.slice("sha256:".length) }],
      },
    },
    components: coordinates.map((coordinate) => {
      const identity = packageIdentity(coordinate);
      return {
        type: "library",
        "bom-ref": identity.purl,
        ...(identity.group === undefined ? {} : { group: identity.group }),
        name: identity.name,
        version: identity.version,
        purl: identity.purl,
      };
    }),
    dependencies: [
      {
        ref: rootRef,
        dependsOn: coordinates.map((coordinate) => packageIdentity(coordinate).purl),
      },
      ...coordinates.map((coordinate) => ({
        ref: packageIdentity(coordinate).purl,
        dependsOn: [],
      })),
    ],
  };
}

export async function installedDependencyCoordinates(root) {
  const packages = await collectInstalledPackages(resolve(root, "node_modules"));
  return [...packages.keys()].sort();
}

export function createNodeDistributionManifest(input) {
  const files = [...input.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const dependencies = [...input.dependencies].sort();
  return {
    schemaVersion: 1,
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
    value.schemaVersion !== 1 ||
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
    fail(
      "node_distribution_manifest_invalid",
      "The Node distribution manifest structure is invalid.",
    );
  }
  const paths = [];
  for (const entry of value.files) {
    if (entry?.kind === "file") {
      if (
        !exactKeys(entry, ["path", "kind", "size", "mode", "sha256"]) ||
        !safeRelativePath(entry.path) ||
        !Number.isInteger(entry.size) ||
        entry.size < 0 ||
        entry.size > maximumArchiveBytes ||
        !Number.isInteger(entry.mode) ||
        entry.mode < 0 ||
        entry.mode > 0o777 ||
        !digestPattern.test(entry.sha256)
      ) {
        fail("node_distribution_manifest_invalid", "A Node distribution file manifest is invalid.");
      }
    } else if (entry?.kind === "symlink") {
      if (
        !exactKeys(entry, ["path", "kind", "target"]) ||
        !safeRelativePath(entry.path) ||
        typeof entry.target !== "string" ||
        entry.target.length < 1 ||
        entry.target.length > 1024 ||
        isAbsolute(entry.target) ||
        /[\0\r\n]/u.test(entry.target)
      ) {
        fail(
          "node_distribution_manifest_invalid",
          "A Node distribution symbolic-link manifest is invalid.",
        );
      }
    } else
      fail(
        "node_distribution_manifest_invalid",
        "A Node distribution manifest entry kind is invalid.",
      );
    paths.push(entry.path);
  }
  if (
    paths.some((path, index) => index > 0 && paths[index - 1] >= path) ||
    value.contentDigest !== canonicalDigest(value.files) ||
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
    fail(
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
    fail(
      "node_distribution_artifact_invalid",
      "The Node distribution artifact descriptor is invalid.",
    );
  }
  return value;
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
  const paths = stdout.split("\n").filter(Boolean).map(archiveEntryPath).filter(Boolean);
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
    await execFileAsync("tar", ["-xzf", archive, "-C", payloadRoot], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
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
    if (canonicalJson(actualFiles) !== canonicalJson(manifest.files))
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
          "Lervo Node error (invalid_arguments): Usage: lervo-node --config <config.json>\n"
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

export { canonicalJson, manifestName, maximumArchiveBytes };
