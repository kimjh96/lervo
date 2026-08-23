import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import { canonicalJson } from "./release-artifact-manifest.mjs";
import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  firstPublicationIntentPhrase,
  firstPublicationSecondFactorPhrase,
} from "./first-publication-operator-confirmations.mjs";
import {
  createNpmInteractiveFirstPublicationObservation,
  isSupportedNpmInteractiveClient,
  npmInteractiveFirstPublicationEnvironmentReasons,
} from "./npm-interactive-first-publication-policy.mjs";

const execFileAsync = promisify(execFile);

function fail(code, message = "The interactive npm first-publication execution conditions are invalid.") {
  throw new FirstPublicationBootstrapError(code, message);
}

function withoutNpmConfiguration(environment) {
  return Object.fromEntries(Object.entries(environment).filter(
    ([name]) => !name.toLowerCase().startsWith("npm_config_"),
  ));
}

function runWithTty(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 && signal === null) resolvePromise();
      else reject(new Error("interactive command failed"));
    });
  });
}

async function jsonCommand(execute, command, args, options) {
  try {
    const { stdout } = await execute(command, args, {
      ...options,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch {
    fail("npm_interactive_first_publication_observation_failed");
  }
}

export async function prepareNpmInteractiveFirstPublisher({
  bootstrap,
  userConfigPath,
}, {
  execute = execFileAsync,
  confirm,
  runInteractive = runWithTty,
  environment = process.env,
  npmCommand = "npm",
  stdinIsTTY = process.stdin.isTTY === true,
  stdoutIsTTY = process.stdout.isTTY === true,
  stderrIsTTY = process.stderr.isTTY === true,
} = {}) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  if (
    typeof execute !== "function" || typeof confirm !== "function" ||
    typeof runInteractive !== "function" || typeof userConfigPath !== "string" ||
    !isAbsolute(userConfigPath) ||
    npmInteractiveFirstPublicationEnvironmentReasons({
      environment, stdinIsTTY, stdoutIsTTY, stderrIsTTY,
    }).length > 0
  ) fail("npm_interactive_first_publication_preflight_failed");
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-first-publish-"));
  const globalConfigPath = resolve(temporaryRoot, "global.npmrc");
  await writeFile(globalConfigPath, "", { encoding: "utf8", mode: 0o600 });
  const commandOptions = {
    cwd: temporaryRoot,
    env: {
      ...withoutNpmConfiguration(environment),
      NPM_CONFIG_CACHE: resolve(temporaryRoot, "cache"),
      NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
      NPM_CONFIG_USERCONFIG: userConfigPath,
      NO_COLOR: "1",
    },
  };
  let attempted = false;
  let prepared = false;
  try {
    let npmVersion;
    try {
      npmVersion = await execute(npmCommand, ["--version"], {
        ...commandOptions,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
    } catch {
      fail("npm_interactive_first_publication_client_invalid");
    }
    if (!isSupportedNpmInteractiveClient(npmVersion.stdout)) {
      fail("npm_interactive_first_publication_client_invalid");
    }
    const profile = await jsonCommand(execute, npmCommand, [
      "profile", "get", "--registry", bootstrap.target.registry, "--json",
    ], commandOptions);
    const observation = createNpmInteractiveFirstPublicationObservation({
      npmVersion: npmVersion.stdout,
      profile,
      environment,
      stdinIsTTY,
      stdoutIsTTY,
      stderrIsTTY,
    });
    if (observation.reasons.includes("npm_client_unsupported")) {
      fail("npm_interactive_first_publication_client_invalid");
    }
    if (observation.reasons.includes("npm_write_2fa_not_ready")) {
      fail("npm_interactive_first_publication_2fa_not_ready");
    }
    const phrase = firstPublicationIntentPhrase(bootstrap);
    if (await confirm({ phase: "before_publication", phrase }) !== phrase) {
      fail("npm_interactive_first_publication_not_confirmed");
    }
    prepared = true;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail("npm_interactive_first_publication_preflight_failed");
  }

  return {
    async publish({ target, artifact, tarballPath }) {
      if (!prepared || attempted || !isAbsolute(tarballPath ?? "") ||
          canonicalJson(target) !== canonicalJson(bootstrap.target) ||
          canonicalJson(artifact) !== canonicalJson(bootstrap.release.artifact)) {
        fail("npm_interactive_first_publication_request_invalid");
      }
      attempted = true;
      try {
        await runInteractive(npmCommand, [
          "publish",
          tarballPath,
          "--registry",
          target.registry,
          "--tag",
          target.distTag,
          "--access",
          target.access,
          "--ignore-scripts",
        ], commandOptions);
      } catch {
        fail("npm_interactive_first_publication_failed");
      }
      let secondFactorConfirmation;
      try {
        secondFactorConfirmation = await confirm({
          phase: "second_factor_attestation",
          phrase: firstPublicationSecondFactorPhrase,
        });
      } catch {
        fail("npm_interactive_first_publication_2fa_unconfirmed");
      }
      if (secondFactorConfirmation !== firstPublicationSecondFactorPhrase) {
        fail("npm_interactive_first_publication_2fa_unconfirmed");
      }
      const coordinate = `${target.package}@${target.version}`;
      const [metadata, tags] = await Promise.all([
        jsonCommand(execute, npmCommand, [
          "view", coordinate, "dist", "--registry", target.registry, "--json",
        ], commandOptions),
        jsonCommand(execute, npmCommand, [
          "view", target.package, "dist-tags", "--registry", target.registry, "--json",
        ], commandOptions),
      ]);
      if (
        metadata?.integrity !== artifact.registryIntegrity ||
        metadata.shasum !== artifact.registryShasum ||
        tags?.[target.distTag] !== target.version
      ) fail("npm_interactive_first_publication_verification_failed");
      return {
        registry: target.registry,
        package: target.package,
        version: target.version,
        distTag: target.distTag,
        registryIntegrity: metadata.integrity,
        registryShasum: metadata.shasum,
      };
    },
    async close() {
      prepared = false;
      await rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}
