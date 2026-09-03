import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { npmPublicRegistry } from "../../lib/release-publication-authorization.mjs";
import { observeNpmPublicPackage } from "./npm-public-package-observer.mjs";

const execFileAsync = promisify(execFile);

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/u.exec(value.trim());
  return match?.slice(1).map(Number);
}

function supportsTrustList(version) {
  if (!version) return false;
  const minimum = [11, 15, 0];
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

function unavailable(reason) {
  return { schemaVersion: 1, source: "npm_trust", state: "unavailable", reason };
}

export async function observeNpmTrustedPublisher({
  execute = execFileAsync,
  npmCommand = "npm",
  environment = process.env,
  request = globalThis.fetch,
  observePackage = observeNpmPublicPackage,
} = {}) {
  const packageObservation = await observePackage({ request });
  if (packageObservation.state === "not_found") {
    return {
      schemaVersion: 1,
      source: "npm_trust",
      state: "public_package_not_found",
      package: "@lervo/cli",
    };
  }
  if (packageObservation.state !== "existing") return unavailable("registry_unavailable");
  const options = {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
    env: {
      ...environment,
      NO_COLOR: "1",
      npm_config_loglevel: "silent",
    },
  };
  let versionOutput;
  try {
    ({ stdout: versionOutput } = await execute(npmCommand, ["--version"], options));
  } catch {
    return unavailable("client_unavailable");
  }
  if (!supportsTrustList(parseVersion(versionOutput))) {
    return unavailable("client_unsupported");
  }
  let stdout;
  try {
    ({ stdout } = await execute(
      npmCommand,
      ["trust", "list", "@lervo/cli", "--registry", npmPublicRegistry, "--json"],
      options,
    ));
  } catch {
    return unavailable("authentication_or_registry_unavailable");
  }
  if (stdout.trim().length === 0) {
    return {
      schemaVersion: 1,
      source: "npm_trust",
      state: "not_configured",
      package: "@lervo/cli",
    };
  }
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    return unavailable("response_invalid");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.type !== "string" ||
    !Array.isArray(value.permissions)
  )
    return unavailable("response_invalid");
  return {
    schemaVersion: 1,
    source: "npm_trust",
    state: "configured",
    package: "@lervo/cli",
    provider: value.type,
    repository: value.repository ?? null,
    workflow: value.file ?? null,
    environment: value.environment ?? null,
    permissions: [...value.permissions].sort(),
  };
}
