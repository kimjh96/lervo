import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";
import {
  isSupportedNpmStageClient,
  npmStageEnvironmentReasons,
  withoutNpmConfiguration,
} from "./npm-stage-client-policy.mjs";
import {
  parseNpmStageList,
  parseNpmStageView,
  sameNpmStage,
} from "./npm-staged-package-review-response.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";

const executeFile = promisify(execFile);
const maximumUserConfigBytes = 64 * 1024;

function fail(code, message = "Interactive npm stage approval could not be prepared.") {
  throw new FirstPublicationBootstrapError(code, message);
}

function forwardRedacted(stream, output, secret) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    let value = pending + chunk;
    pending = "";
    while (value.length > 0) {
      const found = value.indexOf(secret);
      if (found >= 0) {
        output.write(`${value.slice(0, found)}[stage-id]`);
        value = value.slice(found + secret.length);
        continue;
      }
      let suffixLength = Math.min(secret.length - 1, value.length);
      while (suffixLength > 0 &&
          value.slice(-suffixLength) !== secret.slice(0, suffixLength)) {
        suffixLength -= 1;
      }
      output.write(value.slice(0, value.length - suffixLength));
      pending = value.slice(value.length - suffixLength);
      break;
    }
  });
  stream.on("end", () => {
    if (pending.length > 0) output.write(pending);
  });
}

function executeInteractive(command, args, options, stageId) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });
    forwardRedacted(child.stdout, process.stdout, stageId);
    forwardRedacted(child.stderr, process.stderr, stageId);
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("npm stage approval timed out"));
    }, 10 * 60 * 1000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else reject(new Error("npm stage approval failed"));
    });
  });
}

function matchesExpected(stage, expectedStage) {
  return stage.idDigest === expectedStage.idDigest &&
    stage.createdAt === expectedStage.createdAt &&
    stage.distTag === expectedStage.distTag && stage.shasum === expectedStage.shasum;
}

export async function prepareNpmInteractiveStageApproval({
  registry,
  packageName,
  version,
  expectedStage,
  userConfigPath,
}, {
  execute = executeFile,
  runInteractive = executeInteractive,
  environment = process.env,
  npmCommand = "npm",
  stdinIsTTY = process.stdin.isTTY === true,
  stdoutIsTTY = process.stdout.isTTY === true,
  stderrIsTTY = process.stderr.isTTY === true,
} = {}) {
  if (
    registry !== npmPublicRegistry || packageName !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(version ?? "") ||
    !isAbsolute(userConfigPath ?? "") || typeof execute !== "function" ||
    typeof runInteractive !== "function"
  ) throw new TypeError("npm interactive stage approval input is invalid");
  const reasons = npmStageEnvironmentReasons({
    environment,
    interactive: true,
    stdinIsTTY,
    stdoutIsTTY,
    stderrIsTTY,
  });
  if (reasons.length > 0) fail(
    "first_publication_stage_approval_environment_blocked",
    "An interactive terminal, non-automated execution, and absence of environment credentials are required.",
  );
  let configContents;
  try {
    configContents = await readRegularReleaseFile(userConfigPath, maximumUserConfigBytes);
  } catch {
    fail("first_publication_stage_approval_user_config_invalid");
  }
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-stage-approve-"));
  const workingDirectory = resolve(temporaryRoot, "work");
  const globalConfigPath = resolve(temporaryRoot, "global.npmrc");
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try {
      await rm(temporaryRoot, { recursive: true, force: true });
    } catch {
      fail("first_publication_stage_approval_cleanup_failed");
    }
  };
  try {
    await mkdir(workingDirectory, { mode: 0o700 });
    await writeFile(globalConfigPath, "", { mode: 0o600 });
    const options = {
      cwd: workingDirectory,
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
      fail("first_publication_stage_approval_npm_client_unavailable");
    }
    if (!isSupportedNpmStageClient(npmVersion)) {
      fail("first_publication_stage_approval_npm_client_unsupported");
    }
    let selected;
    try {
      const { stdout } = await execute(npmCommand, [
        "stage", "list", packageName, "--registry", registry, "--json",
      ], options);
      selected = parseNpmStageList(stdout, version);
    } catch {
      fail("first_publication_stage_approval_stage_unavailable");
    }
    if (selected.state !== "selected" || !matchesExpected(selected.stage, expectedStage)) {
      fail("first_publication_stage_approval_stage_mismatch");
    }
    const readView = async () => {
      let viewed;
      try {
        const { stdout } = await execute(npmCommand, [
          "stage", "view", selected.stage.id, "--registry", registry, "--json",
        ], options);
        viewed = parseNpmStageView(stdout);
      } catch {
        fail("first_publication_stage_approval_stage_unavailable");
      }
      if (!sameNpmStage(selected.stage, viewed) || !matchesExpected(viewed, expectedStage)) {
        fail("first_publication_stage_approval_stage_mismatch");
      }
      await assertReleaseFilesUnchanged([{
        path: userConfigPath,
        contents: configContents,
        maximumSize: maximumUserConfigBytes,
      }]);
    };
    await readView();
    return {
      recheck: readView,
      approve: async () => {
        await runInteractive(npmCommand, [
          "stage", "approve", selected.stage.id, "--registry", registry,
        ], options, selected.stage.id);
        await assertReleaseFilesUnchanged([{
          path: userConfigPath,
          contents: configContents,
          maximumSize: maximumUserConfigBytes,
        }]);
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
