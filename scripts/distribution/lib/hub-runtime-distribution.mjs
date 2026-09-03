import { execFile } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import {
  canonicalJson,
  collectDistributionEntries,
  currentDistributionPlatform,
  maximumArchiveBytes,
  sha256File,
} from "./node-runtime-distribution.mjs";
import { canonicalDigest, sha256 } from "../../shared/release-artifact-manifest.mjs";

const execFileAsync = promisify(execFile);
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const versionPattern = /^\d+\.\d+\.\d+$/u;
const maximumFiles = 1_024;
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

function fail(code, message, options) {
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

export function createHubDistributionSbom(version, bundleSha256) {
  const rootRef = `pkg:generic/lervo-hub@${version}`;
  return {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": rootRef,
        name: "lervo-hub",
        version,
        hashes: [{ alg: "SHA-256", content: bundleSha256.slice("sha256:".length) }],
      },
    },
    components: [],
    dependencies: [{ ref: rootRef, dependsOn: [] }],
  };
}

export function createHubDistributionManifest(input) {
  const files = [...input.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return {
    schemaVersion: 1,
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
    value.schemaVersion !== 1 ||
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
    fail(
      "hub_distribution_manifest_invalid",
      "The Hub distribution manifest structure is invalid.",
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
        fail("hub_distribution_manifest_invalid", "A Hub distribution file manifest is invalid.");
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
          "hub_distribution_manifest_invalid",
          "A Hub distribution symbolic-link manifest is invalid.",
        );
      }
    } else
      fail(
        "hub_distribution_manifest_invalid",
        "A Hub distribution manifest entry kind is invalid.",
      );
    paths.push(entry.path);
  }
  if (
    paths.some((path, index) => index > 0 && paths[index - 1] >= path) ||
    value.contentDigest !== canonicalDigest(value.files) ||
    !paths.includes("dist/bin.js") ||
    !paths.includes("package.json") ||
    !paths.includes("README.md") ||
    !paths.includes("sbom.cdx.json") ||
    requiredHubAssetPaths.some((path) => !paths.includes(path))
  ) {
    fail(
      "hub_distribution_manifest_invalid",
      "The Hub distribution manifest digest, ordering, or required files are invalid.",
    );
  }
  return value;
}

async function availableLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise((resolvePromise, reject) =>
    server.close((error) => (error === undefined ? resolvePromise() : reject(error))),
  );
  if (typeof address !== "object" || address === null)
    fail("hub_distribution_smoke_failed", "The isolated Hub port could not be determined.");
  return address.port;
}

async function ownerFile(path, bytes) {
  await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
}

async function smokeConfiguredHub(payloadRoot, entrypoint, temporaryRoot) {
  const fixture = resolve(temporaryRoot, "configured-smoke");
  const secrets = resolve(fixture, "secrets");
  const state = resolve(fixture, "state");
  await mkdir(secrets, { recursive: true, mode: 0o700 });
  await mkdir(resolve(state, "command-cas"), { recursive: true, mode: 0o700 });
  const command = generateKeyPairSync("ed25519");
  const policy = generateKeyPairSync("ed25519");
  await ownerFile(
    resolve(secrets, "command.pem"),
    command.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  await ownerFile(
    resolve(secrets, "policy.pem"),
    policy.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  await ownerFile(resolve(secrets, "review.secret"), randomBytes(32));
  await ownerFile(
    resolve(secrets, "credentials.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      credentials: [
        {
          token: randomBytes(48).toString("base64url"),
          principalId: "node_distribution_smoke",
          permissions: ["sync.write"],
          projects: [],
        },
      ],
    })}\n`,
  );
  await ownerFile(
    resolve(secrets, "signing.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      policy: { keyId: "key_distribution_policy_01", privateKeyPath: "policy.pem" },
      command: { keyId: "key_distribution_command_01", privateKeyPath: "command.pem" },
    })}\n`,
  );
  const port = await availableLoopbackPort();
  const config = resolve(fixture, "config.json");
  await ownerFile(
    config,
    `${JSON.stringify({
      schemaVersion: 1,
      listen: { host: "127.0.0.1", port },
      storage: {
        databasePath: resolve(state, "hub.sqlite"),
        commandCasPath: resolve(state, "command-cas"),
      },
      identity: { hubIdentityHash: `sha256:${"8".repeat(64)}` },
      credentialsFile: resolve(secrets, "credentials.json"),
      signingFile: resolve(secrets, "signing.json"),
      control: {
        reviewGrantSecretPath: resolve(secrets, "review.secret"),
        reviewGrantTtlSeconds: 60,
      },
      cleanup: {
        workerId: "hub:distribution:smoke",
        cycleIntervalMs: 60_000,
        maximumScannedObjects: 100,
      },
    })}\n`,
  );
  const result = await execFileAsync(
    process.execPath,
    [resolve(payloadRoot, entrypoint), "--config", config],
    {
      cwd: payloadRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      timeout: 1_500,
      killSignal: "SIGTERM",
    },
  ).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
  if (result.stdout !== `Lervo Hub started on 127.0.0.1:${port}.\n` || result.stderr !== "") {
    fail(
      "hub_distribution_smoke_failed",
      "The isolated Hub distribution did not start with the real configuration.",
    );
  }
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
    fail(
      "hub_distribution_artifact_invalid",
      "The Hub distribution artifact descriptor is invalid.",
    );
  }
  return value;
}

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
  const paths = stdout.split("\n").filter(Boolean).map(archiveEntryPath).filter(Boolean);
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
    await execFileAsync("tar", ["-xzf", archive, "-C", payloadRoot], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
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
    if (canonicalJson(actualFiles) !== canonicalJson(manifest.files))
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
      ).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
      if (
        result.stdout !== "" ||
        result.stderr !==
          "Lervo Hub error (invalid_arguments): Usage: lervo-hub --config <config.json>\n"
      ) {
        fail(
          "hub_distribution_smoke_failed",
          "The isolated Hub distribution entrypoint did not start as expected.",
        );
      }
      await smokeConfiguredHub(payloadRoot, manifest.entrypoint, temporaryRoot);
    }
    return { artifact, manifest, payloadRoot, temporaryRoot };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
