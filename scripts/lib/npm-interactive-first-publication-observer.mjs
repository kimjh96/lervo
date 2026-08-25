import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";
import {
  createNpmInteractiveFirstPublicationObservation,
  createNpmInteractiveFirstPublicationObservationFromReasons,
  isSupportedNpmInteractiveClient,
  npmInteractiveFirstPublicationEnvironmentReasons,
} from "./npm-interactive-first-publication-policy.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";

const execFileAsync = promisify(execFile);
const maximumUserConfigBytes = 64 * 1024;

function withoutNpmConfiguration(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.toLowerCase().startsWith("npm_config_")),
  );
}

export async function observeNpmInteractiveFirstPublication(
  { registry, userConfigPath },
  {
    execute = execFileAsync,
    environment = process.env,
    npmCommand = "npm",
    stdinIsTTY = process.stdin.isTTY === true,
    stdoutIsTTY = process.stdout.isTTY === true,
    stderrIsTTY = process.stderr.isTTY === true,
  } = {},
) {
  if (
    registry !== npmPublicRegistry ||
    !isAbsolute(userConfigPath ?? "") ||
    typeof execute !== "function"
  ) {
    throw new TypeError("npm interactive first-publication observer input is invalid");
  }
  const environmentReasons = npmInteractiveFirstPublicationEnvironmentReasons({
    environment,
    stdinIsTTY,
    stdoutIsTTY,
    stderrIsTTY,
  });
  if (environmentReasons.length > 0) {
    return createNpmInteractiveFirstPublicationObservationFromReasons(environmentReasons);
  }
  const userConfigContents = await readRegularReleaseFile(userConfigPath, maximumUserConfigBytes);
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-first-preflight-"));
  const globalConfigPath = resolve(temporaryRoot, "global.npmrc");
  await writeFile(globalConfigPath, "", { encoding: "utf8", mode: 0o600 });
  const options = {
    cwd: temporaryRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
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
  try {
    let observation;
    let npmVersion;
    try {
      ({ stdout: npmVersion } = await execute(npmCommand, ["--version"], options));
    } catch {
      observation = createNpmInteractiveFirstPublicationObservationFromReasons([
        "npm_client_unavailable",
      ]);
    }
    if (!observation && !isSupportedNpmInteractiveClient(npmVersion)) {
      observation = createNpmInteractiveFirstPublicationObservationFromReasons([
        "npm_client_unsupported",
      ]);
    }
    if (!observation) {
      let profile;
      try {
        const { stdout } = await execute(
          npmCommand,
          ["profile", "get", "--registry", registry, "--json"],
          options,
        );
        profile = JSON.parse(stdout);
      } catch {
        observation = createNpmInteractiveFirstPublicationObservationFromReasons([
          "npm_profile_unavailable",
        ]);
      }
      observation ??= createNpmInteractiveFirstPublicationObservation({
        npmVersion,
        profile,
        environment,
        stdinIsTTY,
        stdoutIsTTY,
        stderrIsTTY,
      });
    }
    await assertReleaseFilesUnchanged([
      {
        path: userConfigPath,
        contents: userConfigContents,
        maximumSize: maximumUserConfigBytes,
      },
    ]);
    return observation;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
