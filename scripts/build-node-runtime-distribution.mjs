import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { readJson, repositoryRoot, runPnpm } from "./lib/installed-cli.mjs";
import { isBuiltinModuleSpecifier } from "./lib/node-module-specifier.mjs";
import {
  canonicalJson,
  collectDistributionEntries,
  createNodeDistributionArtifact,
  createNodeDistributionManifest,
  createNodeDistributionSbom,
  currentDistributionPlatform,
  ensureExecutable,
  installedDependencyCoordinates,
  manifestName,
  nativeClaudePackageName,
  NodeRuntimeDistributionError,
  safeOutputPath,
  sha256File,
  validateNodeDistributionManifest,
  verifyNodeDistributionArchive,
} from "./lib/node-runtime-distribution.mjs";
import { sha256 } from "./lib/release-artifact-manifest.mjs";

const execFileAsync = promisify(execFile);
function parse(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.length !== 3 || normalized[0] !== "--output" || normalized[2] !== "--write") {
    throw new NodeRuntimeDistributionError(
      "node_distribution_arguments_invalid",
      "Usage: --output <new-absolute.tar.gz> --write",
    );
  }
  return normalized[1];
}

async function removeDeploymentMetadata(payloadRoot) {
  for (const entry of await readdir(payloadRoot)) {
    if (entry === "node_modules") continue;
    await rm(resolve(payloadRoot, entry), { recursive: true, force: true });
  }
}

async function assertBundle(bundlePath, metafilePath) {
  const [bundle, metafile] = await Promise.all([lstat(bundlePath), readJson(metafilePath)]);
  if (
    !bundle.isFile() ||
    bundle.isSymbolicLink() ||
    bundle.size < 1 ||
    metafile.outputs?.["apps/node-runtime/dist/bin.js"]?.entryPoint !==
      "apps/node-runtime/src/bin.ts"
  ) {
    throw new NodeRuntimeDistributionError(
      "node_distribution_bundle_invalid",
      "Build the Node runtime bundle first.",
    );
  }
  const externalImports = Object.values(metafile.outputs ?? {})
    .flatMap((output) => output.imports ?? [])
    .filter((entry) => entry.external && !isBuiltinModuleSpecifier(entry.path))
    .map((entry) => entry.path)
    .sort()
    .filter((path, index, paths) => index === 0 || paths[index - 1] !== path);
  if (canonicalJson(externalImports) !== canonicalJson(["@anthropic-ai/claude-agent-sdk"])) {
    throw new NodeRuntimeDistributionError(
      "node_distribution_bundle_invalid",
      "The Node runtime bundle external imports differ from the approved scope.",
    );
  }
}

async function buildDistribution(outputArgument) {
  const output = await safeOutputPath(outputArgument);
  if (!output.endsWith(".tar.gz")) {
    throw new NodeRuntimeDistributionError(
      "node_distribution_arguments_invalid",
      "The distribution archive extension must be .tar.gz.",
    );
  }
  const artifactOutput = await safeOutputPath(`${output}.artifact.json`);
  const runtimePackage = await readJson(resolve(repositoryRoot, "apps/node-runtime/package.json"));
  const runtimeVersion = runtimePackage.version;
  const platform = currentDistributionPlatform();
  const nativePackage = nativeClaudePackageName(platform);
  if (nativePackage === null) {
    throw new NodeRuntimeDistributionError(
      "node_distribution_platform_unsupported",
      "The current operating system and CPU are not a Node distribution target.",
    );
  }
  const bundlePath = resolve(repositoryRoot, "apps/node-runtime/dist/bin.js");
  const metafilePath = resolve(repositoryRoot, "apps/node-runtime/dist/bin.metafile.json");
  await assertBundle(bundlePath, metafilePath);

  const staging = await mkdtemp(resolve(dirname(output), ".lervo-node-build-"));
  const payloadRoot = resolve(staging, "payload");
  const stagedArchive = resolve(staging, basename(output));
  try {
    await runPnpm([
      "--offline",
      "--config.inject-workspace-packages=true",
      "--config.package-import-method=copy",
      "--filter",
      "@lervo/node-runtime-dependencies",
      "deploy",
      "--prod",
      payloadRoot,
    ]);
    await removeDeploymentMetadata(payloadRoot);
    await mkdir(resolve(payloadRoot, "dist"));
    await copyFile(bundlePath, resolve(payloadRoot, "dist/bin.js"));
    await ensureExecutable(resolve(payloadRoot, "dist/bin.js"));
    await copyFile(
      resolve(repositoryRoot, "docs/distribution/node-runtime-distribution.md"),
      resolve(payloadRoot, "README.md"),
    );
    await writeFile(
      resolve(payloadRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "@lervo/node-runtime-distribution",
          version: runtimeVersion,
          private: true,
          type: "module",
          engines: { node: ">=22.13" },
          bin: { "lervo-node": "./dist/bin.js" },
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o644, flag: "wx" },
    );

    const dependencies = await installedDependencyCoordinates(payloadRoot);
    if (!dependencies.includes(`${nativePackage}@0.3.226`)) {
      throw new NodeRuntimeDistributionError(
        "node_distribution_native_runtime_mismatch",
        "The Claude native runtime closure for the current platform is missing.",
      );
    }
    const bundleBytes = await readFile(resolve(payloadRoot, "dist/bin.js"));
    const sbom = createNodeDistributionSbom(runtimeVersion, dependencies, sha256(bundleBytes));
    await writeFile(resolve(payloadRoot, "sbom.cdx.json"), canonicalJson(sbom), {
      encoding: "utf8",
      mode: 0o644,
      flag: "wx",
    });
    const files = await collectDistributionEntries(payloadRoot, new Set([manifestName]));
    const sbomBytes = await readFile(resolve(payloadRoot, "sbom.cdx.json"));
    const manifest = validateNodeDistributionManifest(
      createNodeDistributionManifest({
        runtimeVersion,
        platform,
        files,
        dependencies,
        sbomSha256: sha256(sbomBytes),
      }),
    );
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(resolve(payloadRoot, manifestName), manifestBytes, { mode: 0o644, flag: "wx" });
    await execFileAsync("tar", ["--no-xattrs", "-czf", stagedArchive, "-C", payloadRoot, "."], {
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    const archiveInfo = await lstat(stagedArchive);
    const artifact = createNodeDistributionArtifact({
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
    const verified = await verifyNodeDistributionArchive({
      archive: stagedArchive,
      artifact: stagedArtifact,
      expectedSha256: artifact.sha256,
      requireCurrentPlatform: true,
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
    `Created and verified the standalone Lervo Node distribution.\n` +
      `archive: ${result.output}\nartifact: ${result.artifactOutput}\nsha256: ${result.artifact.sha256}\n`,
  );
} catch (error) {
  const code =
    error instanceof NodeRuntimeDistributionError ? error.code : "node_distribution_build_failed";
  process.stderr.write(`${code}: The standalone Lervo Node distribution could not be created.\n`);
  process.exitCode = 1;
}
