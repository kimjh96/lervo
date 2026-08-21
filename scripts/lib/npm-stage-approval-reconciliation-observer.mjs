import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";
import {
  isSupportedNpmStageClient,
  npmStageEnvironmentReasons,
  withoutNpmConfiguration,
} from "./npm-stage-client-policy.mjs";
import { observeFirstPublicationReconciliation } from
  "./npm-first-publication-reconciliation-observer.mjs";
import { parseNpmStageListResponse } from
  "./npm-staged-package-review-response.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";

const executeFile = promisify(execFile);
const maximumUserConfigBytes = 64 * 1024;

function unavailable(reason) {
  return {
    schemaVersion: 1,
    source: "npm_stage_approval_reconciliation",
    state: "unavailable",
    reason,
  };
}

function stageDisposition(stages, version, expectedIdDigest) {
  const matches = stages.filter((stage) => stage.version === version);
  if (matches.length === 0) return { state: "absent" };
  if (matches.length > 1) return { state: "ambiguous" };
  return matches[0].idDigest === expectedIdDigest
    ? { state: "present" }
    : { state: "replacement_observed" };
}

export async function observeNpmStageApprovalReconciliation({
  registry,
  packageName,
  version,
  distTag,
  expectedStageIdDigest,
  userConfigPath,
}, {
  execute = executeFile,
  observePublicRelease = observeFirstPublicationReconciliation,
  environment = process.env,
  npmCommand = "npm",
} = {}) {
  if (
    registry !== npmPublicRegistry || packageName !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(version ?? "") ||
    !["latest", "next"].includes(distTag) ||
    !/^sha256:[a-f0-9]{64}$/u.test(expectedStageIdDigest ?? "") ||
    !isAbsolute(userConfigPath ?? "") || typeof execute !== "function" ||
    typeof observePublicRelease !== "function"
  ) throw new TypeError("npm stage approval reconciliation input is invalid");
  if (npmStageEnvironmentReasons({ environment }).length > 0) {
    return unavailable("environment_invalid");
  }
  let configContents;
  try {
    configContents = await readRegularReleaseFile(userConfigPath, maximumUserConfigBytes);
  } catch {
    return unavailable("user_config_unavailable");
  }
  let temporaryRoot;
  let result;
  try {
    temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-stage-reconcile-"));
    const cwd = resolve(temporaryRoot, "work");
    const globalConfigPath = resolve(temporaryRoot, "global.npmrc");
    await mkdir(cwd, { mode: 0o700 });
    await writeFile(globalConfigPath, "", { mode: 0o600 });
    const options = {
      cwd,
      encoding: "utf8",
      maxBuffer: 256 * 1024,
      timeout: 30_000,
      env: {
        ...withoutNpmConfiguration(environment),
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
    if (!result && !isSupportedNpmStageClient(npmVersion)) {
      result = unavailable("npm_client_unsupported");
    }
    const readStages = async () => {
      const { stdout } = await execute(npmCommand, [
        "stage", "list", packageName, "--registry", registry, "--json",
      ], options);
      return parseNpmStageListResponse(stdout);
    };
    let firstStages;
    if (!result) {
      try {
        firstStages = await readStages();
      } catch {
        result = unavailable("stage_list_unavailable");
      }
    }
    let publicRelease;
    if (!result) {
      publicRelease = await observePublicRelease({
        registry,
        package: packageName,
        version,
        distTag,
      });
      let secondStages;
      try {
        secondStages = await readStages();
      } catch {
        result = unavailable("stage_list_unavailable");
      }
      if (!result && canonicalJson(firstStages) !== canonicalJson(secondStages)) {
        result = unavailable("stage_list_changed");
      }
    }
    try {
      await assertReleaseFilesUnchanged([{
        path: userConfigPath,
        contents: configContents,
        maximumSize: maximumUserConfigBytes,
      }]);
    } catch {
      result = unavailable("user_config_changed");
    }
    result ??= {
      schemaVersion: 1,
      source: "npm_stage_approval_reconciliation",
      state: "observed",
      registry,
      package: packageName,
      version,
      distTag,
      publicRelease,
      stage: stageDisposition(firstStages, version, expectedStageIdDigest),
      stageListStability: "rechecked_unchanged",
      userConfig: "rechecked_unchanged",
      temporaryFiles: "removed",
    };
  } catch {
    result = unavailable("reconciliation_unavailable");
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
