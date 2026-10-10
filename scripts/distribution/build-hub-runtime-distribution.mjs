import {
  copyNativeFileSyncArtifact,
  nativeFileSyncSourceHash,
} from "../shared/native-file-sync-artifact.mjs";
import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { readJson, repositoryRoot } from "./lib/installed-cli.mjs";
import { isBuiltinModuleSpecifier } from "../shared/node-module-specifier.mjs";
import { readProductReleaseVersion } from "./lib/product-release-version.mjs";
import {
  createHubDistributionArtifact,
  createHubDistributionManifest,
  createHubDistributionSbom,
  HubRuntimeDistributionError,
  hubManifestName,
  validateHubDistributionManifest,
  verifyHubDistributionArchive,
} from "./lib/hub-runtime-distribution.mjs";
import {
  canonicalJson,
  collectDistributionEntries,
  currentDistributionPlatform,
  ensureExecutable,
  safeOutputPath,
  sha256File,
} from "./lib/node-runtime-distribution.mjs";
import { sha256 } from "../shared/release-artifact-manifest.mjs";

const execFileAsync = promisify(execFile);
function targetPlatform(value) {
  if (value === undefined) return currentDistributionPlatform();
  const match = /^(darwin|linux|win32)-(arm64|x64)-(none|glibc|musl)$/u.exec(value);
  if (match === null) {
    throw new HubRuntimeDistributionError(
      "hub_distribution_arguments_invalid",
      "The target platform must use <os>-<arch>-<libc>.",
    );
  }
  const platform = { os: match[1], arch: match[2], libc: match[3] };
  if ((platform.os === "linux") !== (platform.libc !== "none")) {
    throw new HubRuntimeDistributionError(
      "hub_distribution_arguments_invalid",
      "Linux requires glibc or musl; other systems require none.",
    );
  }
  return platform;
}

function parse(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.at(-1) !== "--write") {
    throw new HubRuntimeDistributionError(
      "hub_distribution_arguments_invalid",
      "Usage: --output <new-absolute.tar.gz> [--platform <os>-<arch>-<libc>] --write",
    );
  }
  const values = new Map();
  for (let index = 0; index < normalized.length - 1; index += 2) {
    const key = normalized[index];
    const value = normalized[index + 1];
    if (!["--output", "--platform"].includes(key) || value === undefined || values.has(key)) {
      throw new HubRuntimeDistributionError(
        "hub_distribution_arguments_invalid",
        "Usage: --output <new-absolute.tar.gz> [--platform <os>-<arch>-<libc>] --write",
      );
    }
    values.set(key, value);
  }
  if (values.get("--output") === undefined || values.size > 2) {
    throw new HubRuntimeDistributionError(
      "hub_distribution_arguments_invalid",
      "Usage: --output <new-absolute.tar.gz> [--platform <os>-<arch>-<libc>] --write",
    );
  }
  return { output: values.get("--output"), platform: targetPlatform(values.get("--platform")) };
}

async function assertBundle(bundlePath, metafilePath) {
  const [bundle, metafile] = await Promise.all([lstat(bundlePath), readJson(metafilePath)]);
  if (
    !bundle.isFile() ||
    bundle.isSymbolicLink() ||
    bundle.size < 1 ||
    metafile.outputs?.["apps/hub-runtime/dist/bin.js"]?.entryPoint !== "apps/hub-runtime/src/bin.ts"
  ) {
    throw new HubRuntimeDistributionError(
      "hub_distribution_bundle_invalid",
      "Build the Hub runtime bundle first.",
    );
  }
  const externalImports = Object.values(metafile.outputs ?? {})
    .flatMap((output) => output.imports ?? [])
    .filter((entry) => entry.external && !isBuiltinModuleSpecifier(entry.path))
    .map((entry) => entry.path)
    .sort()
    .filter((path, index, paths) => index === 0 || paths[index - 1] !== path);
  if (canonicalJson(externalImports) !== canonicalJson([])) {
    throw new HubRuntimeDistributionError(
      "hub_distribution_bundle_invalid",
      "The Hub runtime bundle contains an unapproved external import.",
    );
  }
}

async function buildDistribution(input) {
  const output = await safeOutputPath(input.output);
  if (!output.endsWith(".tar.gz"))
    throw new HubRuntimeDistributionError(
      "hub_distribution_arguments_invalid",
      "The distribution archive extension must be .tar.gz.",
    );
  const artifactOutput = await safeOutputPath(`${output}.artifact.json`);
  const runtimeVersion = await readProductReleaseVersion(repositoryRoot);
  const platform = input.platform;
  const bundlePath = resolve(repositoryRoot, "apps/hub-runtime/dist/bin.js");
  await assertBundle(
    bundlePath,
    resolve(repositoryRoot, "apps/hub-runtime/dist/bin.metafile.json"),
  );

  const staging = await mkdtemp(resolve(dirname(output), ".lervo-hub-build-"));
  const payloadRoot = resolve(staging, "payload");
  const stagedArchive = resolve(staging, basename(output));
  try {
    await mkdir(resolve(payloadRoot, "dist"), { recursive: true });
    await copyFile(bundlePath, resolve(payloadRoot, "dist/bin.js"));
    await ensureExecutable(resolve(payloadRoot, "dist/bin.js"));
    const native =
      platform.os === "darwin"
        ? await copyNativeFileSyncArtifact(
            resolve(repositoryRoot, "apps/hub-runtime/dist/native"),
            resolve(payloadRoot, "dist"),
            { required: true, expectedSourceHash: await nativeFileSyncSourceHash(repositoryRoot) },
          )
        : undefined;
    await cp(resolve(repositoryRoot, "apps/hub/assets"), resolve(payloadRoot, "assets"), {
      recursive: true,
      errorOnExist: true,
    });
    await copyFile(
      resolve(repositoryRoot, "docs/distribution/hub-runtime-distribution.md"),
      resolve(payloadRoot, "README.md"),
    );
    await writeFile(
      resolve(payloadRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@lervo/hub-runtime-distribution",
          version: runtimeVersion,
          private: true,
          type: "module",
          engines: { node: ">=22.13" },
          bin: { "lervo-hub": "./dist/bin.js" },
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o644, flag: "wx" },
    );
    const bundleBytes = await readFile(resolve(payloadRoot, "dist/bin.js"));
    const sbom = createHubDistributionSbom(runtimeVersion, sha256(bundleBytes), native);
    await writeFile(resolve(payloadRoot, "sbom.cdx.json"), canonicalJson(sbom), {
      encoding: "utf8",
      mode: 0o644,
      flag: "wx",
    });
    const files = await collectDistributionEntries(payloadRoot, new Set([hubManifestName]));
    const sbomBytes = await readFile(resolve(payloadRoot, "sbom.cdx.json"));
    const manifest = validateHubDistributionManifest(
      createHubDistributionManifest({
        runtimeVersion,
        platform,
        files,
        sbomSha256: sha256(sbomBytes),
      }),
    );
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(resolve(payloadRoot, hubManifestName), manifestBytes, {
      mode: 0o644,
      flag: "wx",
    });
    await execFileAsync("tar", ["--no-xattrs", "-czf", stagedArchive, "-C", payloadRoot, "."], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    const archiveInfo = await lstat(stagedArchive);
    const artifact = createHubDistributionArtifact({
      runtimeVersion,
      platform,
      archiveFileName: basename(output),
      byteCount: archiveInfo.size,
      sha256: await sha256File(stagedArchive),
      manifestSha256: sha256(manifestBytes),
    });
    const stagedArtifact = resolve(staging, `${basename(output)}.artifact.json`);
    await writeFile(stagedArtifact, `${JSON.stringify(artifact, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o644,
      flag: "wx",
    });
    const verified = await verifyHubDistributionArchive({
      archive: stagedArchive,
      artifact: stagedArtifact,
      expectedSha256: artifact.sha256,
      // Cross-host smoke covers JS behavior; target-side verification still owns platform acceptance.
      requireCurrentPlatform: false,
      smoke: true,
    });
    await rm(verified.temporaryRoot, { recursive: true, force: true });
    await chmod(stagedArchive, 0o644);
    await chmod(stagedArtifact, 0o644);
    await rename(stagedArchive, output);
    try {
      await rename(stagedArtifact, artifactOutput);
    } catch (error) {
      await rm(output, { force: true });
      throw error;
    }
    return { output, artifactOutput, artifact };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

try {
  const result = await buildDistribution(parse(process.argv.slice(2)));
  process.stdout.write(
    `Created and verified the standalone Lervo Hub distribution.\narchive: ${result.output}\nartifact: ${result.artifactOutput}\nsha256: ${result.artifact.sha256}\n`,
  );
} catch (error) {
  const code =
    error instanceof HubRuntimeDistributionError ? error.code : "hub_distribution_build_failed";
  process.stderr.write(`${code}: The standalone Lervo Hub distribution could not be created.\n`);
  process.exitCode = 1;
}
