import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import { parse } from "yaml";

import {
  createLocalCliReleaseStatement,
  ReleaseAttestationError,
  validateCliReleaseTag,
  validateLocalCliReleaseStatement,
} from "./lib/cli-release-attestation.mjs";
import {
  ReleaseSbomError,
  validateCliReleaseSbom,
} from "./lib/cli-release-sbom.mjs";
import { readJson, repositoryRoot } from "./lib/installed-cli.mjs";
import { packCliArtifact } from "./lib/packed-cli-artifact.mjs";
import { PnpmProductionGraphError } from "./lib/pnpm-production-graph.mjs";
import {
  ReleaseArtifactManifestError,
  validateReleaseArtifactManifest,
} from "./lib/release-artifact-manifest.mjs";

const paths = {
  bundle: resolve(repositoryRoot, "apps/cli/dist/bin.js"),
  lockfile: resolve(repositoryRoot, "pnpm-lock.yaml"),
  packageManifest: resolve(repositoryRoot, "apps/cli/package.json"),
  packageReadme: resolve(repositoryRoot, "apps/cli/README.md"),
  releaseManifest: resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json"),
  releaseSbom: resolve(repositoryRoot, "apps/cli/release-sbom.cdx.json"),
  rootManifest: resolve(repositoryRoot, "package.json"),
};

function fail(code, message) {
  throw new ReleaseAttestationError(code, message);
}

function parseMode(args) {
  if (args.length === 0) return { mode: "check" };
  if (args.length === 1 && args[0] === "--statement") return { mode: "statement" };
  if (
    (args.length === 2 || args.length === 4) &&
    args[0] === "--prepare" &&
    (args.length === 2 || args[2] === "--expected-tag")
  ) {
    return {
      mode: "prepare",
      outputDirectory: args[1],
      expectedTag: args[3],
    };
  }
  fail("release_attestation_arguments_invalid", "Release statement 명령 인자가 올바르지 않습니다.");
}

async function readInputs() {
  const [
    bundleContents,
    lockfileContents,
    packageManifestContents,
    packageReadmeContents,
    releaseManifestContents,
    releaseSbomContents,
    rootManifest,
  ] = await Promise.all([
    readFile(paths.bundle),
    readFile(paths.lockfile),
    readFile(paths.packageManifest),
    readFile(paths.packageReadme),
    readFile(paths.releaseManifest),
    readFile(paths.releaseSbom),
    readJson(paths.rootManifest),
  ]);
  const releaseManifest = validateReleaseArtifactManifest(
    JSON.parse(releaseManifestContents.toString("utf8")),
  );
  const lockfile = parse(lockfileContents.toString("utf8"));
  validateCliReleaseSbom(
    JSON.parse(releaseSbomContents.toString("utf8")),
    releaseManifest,
    lockfile,
  );
  const packageManifest = JSON.parse(packageManifestContents.toString("utf8"));
  if (
    packageManifest.name !== releaseManifest.artifact.name ||
    packageManifest.version !== releaseManifest.artifact.version ||
    rootManifest.packageManager !== "pnpm@11.18.0"
  ) {
    fail("release_attestation_identity_mismatch", "Release statement package identity가 다릅니다.");
  }
  return {
    bundleContents,
    lockfileContents,
    packageManifestContents,
    packageReadmeContents,
    releaseManifest,
    releaseManifestContents,
    releaseSbomContents,
    packageManager: rootManifest.packageManager,
  };
}

async function prepareReleaseFiles(outputDirectory, tarballPath) {
  if (!isAbsolute(outputDirectory)) {
    fail("release_attestation_output_invalid", "Release 준비 경로는 절대 경로여야 합니다.");
  }
  let stagingDirectory;
  try {
    stagingDirectory = await mkdtemp(resolve(dirname(outputDirectory), ".lervo-release-"));
  } catch {
    fail("release_attestation_output_unavailable", "Release 준비 경로를 새로 만들 수 없습니다.");
  }
  try {
    await copyFile(tarballPath, resolve(stagingDirectory, basename(tarballPath)));
    await copyFile(
      paths.releaseManifest,
      resolve(stagingDirectory, "release-artifact-manifest.json"),
    );
    await copyFile(paths.releaseSbom, resolve(stagingDirectory, "release-sbom.cdx.json"));
    await rename(stagingDirectory, outputDirectory);
  } catch {
    await rm(stagingDirectory, { recursive: true, force: true });
    fail("release_attestation_output_unavailable", "Release 준비 경로를 새로 만들 수 없습니다.");
  }
}

async function main() {
  const command = parseMode(process.argv.slice(2));
  const inputs = await readInputs();
  if (command.expectedTag !== undefined) {
    validateCliReleaseTag(inputs.releaseManifest.artifact.version, command.expectedTag);
  }
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-release-attestation-"));
  try {
    const archiveRoot = resolve(temporaryRoot, "archive");
    await mkdir(archiveRoot);
    const tarballPath = await packCliArtifact(
      archiveRoot,
      inputs.releaseManifest.artifact.version,
    );
    const statementInputs = {
      ...inputs,
      tarballName: basename(tarballPath),
      tarballContents: await readFile(tarballPath),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    };
    const statement = validateLocalCliReleaseStatement(
      createLocalCliReleaseStatement(statementInputs),
      statementInputs,
    );

    if (command.mode === "statement") {
      process.stdout.write(`${JSON.stringify(statement, null, 2)}\n`);
      return;
    }
    if (command.mode === "prepare") {
      await prepareReleaseFiles(command.outputDirectory, tarballPath);
      console.log("CLI release 서명 대상 준비 완료 (3개 파일)");
      return;
    }
    console.log("CLI release unsigned statement 검사 통과 (3개 subject)");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  if (
    error instanceof ReleaseAttestationError ||
    error instanceof ReleaseArtifactManifestError ||
    error instanceof ReleaseSbomError ||
    error instanceof PnpmProductionGraphError
  ) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error("release_attestation_check_failed: CLI release statement 검사를 완료하지 못했습니다.");
  }
  process.exitCode = 1;
}
