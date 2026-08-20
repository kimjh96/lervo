import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  npmPublicRegistry,
  ReleasePublicationAuthorizationError,
} from "./release-publication-authorization.mjs";

const execFileAsync = promisify(execFile);
const minimumNpmVersion = [11, 5, 1];
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
    return normalized === "npm_token" ||
      normalized === "node_auth_token" ||
      (normalized.startsWith("npm_config_") && normalized.includes("auth"));
  });
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
      "npm Trusted Publishing 실행 환경이 올바르지 않습니다.",
    );
  }
}

async function executeJson(execute, npmCommand, args, commandOptions) {
  let stdout;
  try {
    ({ stdout } = await execute(npmCommand, args, {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      ...commandOptions,
    }));
    return JSON.parse(stdout);
  } catch {
    fail(
      "npm_publication_verification_failed",
      "npm registry 게시 결과를 확인하지 못했습니다.",
    );
  }
}

export function createNpmTrustedPublisher({
  environment = process.env,
  execute = execFileAsync,
  npmCommand = "npm",
  nodeVersion = process.version,
} = {}) {
  return async ({ target, artifact, tarballPath }) => {
    validateNpmTrustedPublishingEnvironment(environment, nodeVersion);
    if (target.registry !== npmPublicRegistry) {
      fail(
        "npm_trusted_publishing_target_invalid",
        "npm Trusted Publishing 대상이 올바르지 않습니다.",
      );
    }
    const isolationRoot = await mkdtemp(resolve(tmpdir(), "lervo-npm-publish-"));
    const userConfigPath = resolve(isolationRoot, "user.npmrc");
    const globalConfigPath = resolve(isolationRoot, "global.npmrc");
    try {
      await Promise.all([
        writeFile(userConfigPath, "", "utf8"),
        writeFile(globalConfigPath, "", "utf8"),
      ]);
      const commandOptions = {
        cwd: isolationRoot,
        env: {
          ...environment,
          NPM_CONFIG_USERCONFIG: userConfigPath,
          NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
          NPM_CONFIG_CACHE: resolve(isolationRoot, "cache"),
        },
      };
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
          "npm Trusted Publishing client를 확인하지 못했습니다.",
        );
      }
      if (!meetsMinimum(parseVersion(npmVersion), minimumNpmVersion)) {
        fail(
          "npm_trusted_publishing_client_invalid",
          "npm Trusted Publishing client를 확인하지 못했습니다.",
        );
      }
      try {
        await execute(npmCommand, [
          "publish",
          tarballPath,
          "--registry",
          target.registry,
          "--tag",
          target.distTag,
          "--access",
          target.access,
          "--ignore-scripts",
        ], {
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          ...commandOptions,
        });
      } catch {
        fail(
          "npm_publication_failed",
          "npm registry 게시를 완료하지 못했습니다.",
        );
      }
      const coordinate = `${target.package}@${target.version}`;
      const [metadata, tags] = await Promise.all([
        executeJson(execute, npmCommand, [
          "view",
          coordinate,
          "dist",
          "--registry",
          target.registry,
          "--json",
        ], commandOptions),
        executeJson(execute, npmCommand, [
          "view",
          target.package,
          "dist-tags",
          "--registry",
          target.registry,
          "--json",
        ], commandOptions),
      ]);
      if (
        metadata?.integrity !== artifact.registryIntegrity ||
        metadata.shasum !== artifact.registryShasum ||
        tags?.[target.distTag] !== target.version
      ) {
        fail(
          "npm_publication_verification_failed",
          "npm registry 게시 결과를 확인하지 못했습니다.",
        );
      }
      return {
        registry: target.registry,
        package: target.package,
        version: target.version,
        distTag: target.distTag,
        registryIntegrity: metadata.integrity,
        registryShasum: metadata.shasum,
      };
    } finally {
      await rm(isolationRoot, { recursive: true, force: true });
    }
  };
}
