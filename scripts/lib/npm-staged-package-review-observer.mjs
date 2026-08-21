import { execFile } from "node:child_process";
import { lstat, mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
  releaseVerificationMaximumSizes,
} from "./release-attestation-file-set.mjs";
import { containsNpmCredential } from
  "./npm-interactive-first-publication-policy.mjs";
import {
  parseNpmStageList,
  parseNpmStageView,
  publicNpmStage,
  sameNpmStage,
} from "./npm-staged-package-review-response.mjs";
import {
  createReleasePublicationArtifact,
  npmPublicRegistry,
} from "./release-publication-authorization.mjs";

const executeFile = promisify(execFile);
const maximumUserConfigBytes = 64 * 1024;
const minimumNpmVersion = [11, 15, 0];

function unavailable(reason) {
  return {
    schemaVersion: 1,
    source: "npm_staged_package_review",
    state: "unavailable",
    reason,
  };
}

function supported(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/u.exec(value?.trim() ?? "");
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  for (let index = 0; index < minimumNpmVersion.length; index += 1) {
    if (actual[index] !== minimumNpmVersion[index]) {
      return actual[index] > minimumNpmVersion[index];
    }
  }
  return true;
}

function cleanEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(
    ([name]) => !name.toLowerCase().startsWith("npm_config_"),
  ));
}

function matchingArtifact(actual, expected) {
  return actual.file === expected.file && actual.sha256 === expected.sha256 &&
    actual.registryIntegrity === expected.registryIntegrity &&
    actual.registryShasum === expected.registryShasum;
}

export async function observeNpmStagedPackageReview({
  registry,
  packageName,
  version,
  expectedArtifact,
  userConfigPath,
}, {
  execute = executeFile,
  environment = process.env,
  npmCommand = "npm",
} = {}) {
  if (
    registry !== npmPublicRegistry || packageName !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(version ?? "") ||
    expectedArtifact?.file !== `lervo-cli-${version}.tgz` ||
    !isAbsolute(userConfigPath ?? "") || typeof execute !== "function"
  ) throw new TypeError("npm staged package review observer input is invalid");
  if (containsNpmCredential(environment)) return unavailable("environment_invalid");

  let userConfigContents;
  try {
    userConfigContents = await readRegularReleaseFile(
      userConfigPath,
      maximumUserConfigBytes,
    );
  } catch {
    return unavailable("user_config_unavailable");
  }

  let temporaryRoot;
  let result;
  try {
    temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-stage-review-"));
    const downloadDirectory = resolve(temporaryRoot, "download");
    const globalConfigPath = resolve(temporaryRoot, "global.npmrc");
    await mkdir(downloadDirectory, { mode: 0o700 });
    await writeFile(globalConfigPath, "", { mode: 0o600 });
    const options = {
      cwd: downloadDirectory,
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: 30_000,
      env: {
        ...cleanEnvironment(environment),
        NPM_CONFIG_CACHE: resolve(temporaryRoot, "cache"),
        NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
        NPM_CONFIG_USERCONFIG: userConfigPath,
        NO_COLOR: "1",
        npm_config_loglevel: "silent",
      },
    };
    let npmVersion;
    try {
      ({ stdout: npmVersion } = await execute(npmCommand, ["--version"], options));
    } catch {
      result = unavailable("npm_client_unavailable");
    }
    if (!result && !supported(npmVersion)) result = unavailable("npm_client_unsupported");

    let selected;
    if (!result) {
      try {
        const { stdout } = await execute(npmCommand, [
          "stage", "list", packageName, "--registry", registry, "--json",
        ], options);
        selected = parseNpmStageList(stdout, version);
        if (selected.state === "unavailable") result = unavailable(selected.reason);
      } catch {
        result = unavailable("stage_list_unavailable");
      }
    }

    let firstView;
    if (!result) {
      try {
        const { stdout } = await execute(npmCommand, [
          "stage", "view", selected.stage.id, "--registry", registry, "--json",
        ], options);
        firstView = parseNpmStageView(stdout);
        if (!sameNpmStage(selected.stage, firstView)) {
          result = unavailable("stage_view_mismatch");
        }
      } catch {
        result = unavailable("stage_view_unavailable");
      }
    }

    let artifact;
    if (!result) {
      try {
        await execute(npmCommand, [
          "stage", "download", selected.stage.id, "--registry", registry, "--json",
        ], options);
        const expectedDownload = `lervo-cli-${version}-${selected.stage.id}.tgz`;
        const entries = await readdir(downloadDirectory, { withFileTypes: true });
        if (
          entries.length !== 1 || entries[0].name !== expectedDownload ||
          !entries[0].isFile()
        ) throw new TypeError("npm stage download set is invalid");
        const downloadPath = resolve(downloadDirectory, expectedDownload);
        const metadata = await lstat(downloadPath);
        if (!metadata.isFile() || metadata.size <= 0 ||
            metadata.size > releaseVerificationMaximumSizes.tarball) {
          throw new TypeError("npm stage download is invalid");
        }
        const contents = await readRegularReleaseFile(
          downloadPath,
          releaseVerificationMaximumSizes.tarball,
        );
        artifact = createReleasePublicationArtifact(
          `lervo-cli-${version}.tgz`,
          version,
          contents,
        );
        if (!matchingArtifact(artifact, expectedArtifact) ||
            artifact.registryShasum !== selected.stage.shasum) {
          result = unavailable("tarball_mismatch");
        }
      } catch {
        result ??= unavailable("stage_download_unavailable");
      }
    }

    if (!result) {
      try {
        const { stdout } = await execute(npmCommand, [
          "stage", "view", selected.stage.id, "--registry", registry, "--json",
        ], options);
        if (!sameNpmStage(firstView, parseNpmStageView(stdout))) {
          result = unavailable("stage_changed");
        }
      } catch {
        result = unavailable("stage_changed");
      }
    }
    try {
      await assertReleaseFilesUnchanged([{
        path: userConfigPath,
        contents: userConfigContents,
        maximumSize: maximumUserConfigBytes,
      }]);
    } catch {
      result = unavailable("user_config_changed");
    }
    result ??= {
      schemaVersion: 1,
      source: "npm_staged_package_review",
      state: "observed",
      registry,
      package: packageName,
      version,
      stage: publicNpmStage(selected.stage),
      tarball: {
        byteCount: (await lstat(resolve(
          downloadDirectory,
          `lervo-cli-${version}-${selected.stage.id}.tgz`,
        ))).size,
        sha256: artifact.sha256,
        registryIntegrity: artifact.registryIntegrity,
        registryShasum: artifact.registryShasum,
      },
      metadataStability: "rechecked_unchanged",
      userConfig: "rechecked_unchanged",
      temporaryFiles: "removed",
    };
  } catch {
    result = unavailable("stage_review_unavailable");
  }
  if (temporaryRoot) {
    try {
      await rm(temporaryRoot, { recursive: true, force: true });
    } catch {
      return unavailable("cleanup_failed");
    }
  }
  return result;
}
