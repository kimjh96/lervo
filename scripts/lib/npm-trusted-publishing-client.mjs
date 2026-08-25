import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { ReleasePublicationAuthorizationError } from "./release-publication-authorization.mjs";

const execFileAsync = promisify(execFile);
const minimumNodeVersion = [22, 14, 0];

function fail(code, message) {
  throw new ReleasePublicationAuthorizationError(code, message);
}

function parseVersion(value) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:-.+)?$/u.exec(value.trim());
  return match?.slice(1).map(Number);
}

function meetsMinimum(actual, minimum) {
  if (!actual) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}

function containsRegistryWriteCredential(environment) {
  return Object.entries(environment).some(([name, value]) => {
    if (typeof value !== "string" || value.length === 0) return false;
    const normalized = name.toLowerCase();
    return (
      normalized === "npm_token" ||
      normalized === "node_auth_token" ||
      (normalized.startsWith("npm_config_") && normalized.includes("auth"))
    );
  });
}

function withoutAmbientNpmConfiguration(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !name.toLowerCase().startsWith("npm_config_")),
  );
}

export function validateNpmTrustedPublishingEnvironment(
  environment,
  nodeVersion = process.version,
) {
  if (
    environment?.GITHUB_ACTIONS !== "true" ||
    environment.RUNNER_ENVIRONMENT !== "github-hosted" ||
    typeof environment.ACTIONS_ID_TOKEN_REQUEST_URL !== "string" ||
    environment.ACTIONS_ID_TOKEN_REQUEST_URL.length === 0 ||
    typeof environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== "string" ||
    environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length === 0 ||
    containsRegistryWriteCredential(environment) ||
    !meetsMinimum(parseVersion(nodeVersion), minimumNodeVersion)
  ) {
    fail(
      "npm_trusted_publishing_environment_invalid",
      "The npm Trusted Publishing execution environment is invalid.",
    );
  }
}

export async function prepareIsolatedNpmTrustedPublishingClient({
  environment = process.env,
  execute = execFileAsync,
  minimumNpmVersion,
  npmCommand = "npm",
  nodeVersion = process.version,
  temporaryPrefix = "lervo-npm-publish-",
}) {
  validateNpmTrustedPublishingEnvironment(environment, nodeVersion);
  if (
    !Array.isArray(minimumNpmVersion) ||
    minimumNpmVersion.length !== 3 ||
    minimumNpmVersion.some((part) => !Number.isSafeInteger(part) || part < 0) ||
    typeof execute !== "function" ||
    typeof npmCommand !== "string" ||
    npmCommand.length === 0 ||
    typeof temporaryPrefix !== "string" ||
    temporaryPrefix.length === 0
  ) {
    fail(
      "npm_trusted_publishing_client_invalid",
      "The npm Trusted Publishing client could not be verified.",
    );
  }
  const isolationRoot = await mkdtemp(resolve(tmpdir(), temporaryPrefix));
  const userConfigPath = resolve(isolationRoot, "user.npmrc");
  const globalConfigPath = resolve(isolationRoot, "global.npmrc");
  const commandOptions = {
    cwd: isolationRoot,
    env: {
      ...withoutAmbientNpmConfiguration(environment),
      NPM_CONFIG_USERCONFIG: userConfigPath,
      NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
      NPM_CONFIG_CACHE: resolve(isolationRoot, "cache"),
    },
  };
  let disposed = false;
  async function dispose() {
    if (disposed) return;
    disposed = true;
    await rm(isolationRoot, { recursive: true, force: true });
  }
  try {
    await Promise.all([
      writeFile(userConfigPath, "", { encoding: "utf8", mode: 0o600 }),
      writeFile(globalConfigPath, "", { encoding: "utf8", mode: 0o600 }),
    ]);
    let npmVersion;
    try {
      ({ stdout: npmVersion } = await execute(npmCommand, ["--version"], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        ...commandOptions,
      }));
    } catch {
      fail(
        "npm_trusted_publishing_client_invalid",
        "The npm Trusted Publishing client could not be verified.",
      );
    }
    if (!meetsMinimum(parseVersion(npmVersion), minimumNpmVersion)) {
      fail(
        "npm_trusted_publishing_client_invalid",
        "The npm Trusted Publishing client could not be verified.",
      );
    }
    return {
      async execute(args, maxBuffer = 4 * 1024 * 1024) {
        if (disposed) {
          fail(
            "npm_trusted_publishing_client_invalid",
            "The npm Trusted Publishing client could not be verified.",
          );
        }
        return execute(npmCommand, args, {
          encoding: "utf8",
          maxBuffer,
          ...commandOptions,
        });
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
