import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { checkCliFirstPublicationPreflight } from "../cli-first-publication-preflight.mjs";
import { createNpmInteractiveFirstPublicationObservation } from "../../adapters/npm-interactive-first-publication-policy.mjs";
import { formatFirstPublicationPreflight } from "../first-publication-preflight-formatter.mjs";
import { observeNpmInteractiveFirstPublication } from "../../adapters/npm-interactive-first-publication-observer.mjs";
import { npmPublicRegistry } from "../../../lib/release-publication-authorization.mjs";
import { createFirstPublicationFixture } from "../../test/fixtures/first-publication.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../../..");
const tarballContents = Buffer.from("first-publication-preflight-command-tarball");

function fixture() {
  return createFirstPublicationFixture({
    tarballContents,
    approvalId: "apr_command1",
  });
}

function readyNpm() {
  return createNpmInteractiveFirstPublicationObservation({
    npmVersion: "11.17.0",
    profile: { tfa: { mode: "auth-and-writes", pending: false } },
    environment: {},
    stdinIsTTY: true,
    stdoutIsTTY: true,
    stderrIsTTY: true,
  });
}

async function commandFiles() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-preflight-command-"));
  const source = fixture();
  const releaseDirectory = resolve(root, "release");
  await mkdir(releaseDirectory);
  const publicationAuthorizationPath = resolve(root, "publication.json");
  const bootstrapPath = resolve(root, "bootstrap.json");
  const userConfigPath = resolve(root, "user.npmrc");
  await Promise.all([
    writeFile(resolve(releaseDirectory, source.artifact.file), tarballContents),
    writeFile(publicationAuthorizationPath, JSON.stringify(source.publicationAuthorization)),
    writeFile(bootstrapPath, JSON.stringify(source.bootstrap)),
    writeFile(userConfigPath, "//registry.npmjs.org/:_authToken=local-placeholder\n"),
  ]);
  return {
    root,
    source,
    options: {
      online: true,
      releaseDirectory,
      publicationAuthorizationPath,
      bootstrapPath,
      reservationRoot: resolve(root, "reservations"),
      userConfigPath,
    },
  };
}

describe("first-publication preflight command orchestration", () => {
  it("returns a ready report while leaving the reservation root absent", async () => {
    const prepared = await commandFiles();
    try {
      const report = await checkCliFirstPublicationPreflight(prepared.options, {
        observeNpmPublicPackage: async () => ({
          schemaVersion: 1,
          source: "npm_public_registry",
          state: "not_found",
          package: "@lervo/cli",
        }),
        observeNpmInteractiveFirstPublication: async () => readyNpm(),
        clock: () => "2026-08-21T03:01:00Z",
      });
      assert.equal(report.status, "ready");
      await assert.rejects(lstat(prepared.options.reservationRoot), { code: "ENOENT" });
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects a release source changed during online observation", async () => {
    const prepared = await commandFiles();
    try {
      await assert.rejects(
        checkCliFirstPublicationPreflight(prepared.options, {
          observeNpmPublicPackage: async () => ({
            schemaVersion: 1,
            source: "npm_public_registry",
            state: "not_found",
            package: "@lervo/cli",
          }),
          observeNpmInteractiveFirstPublication: async () => {
            await writeFile(
              resolve(prepared.options.releaseDirectory, prepared.source.artifact.file),
              Buffer.from("changed-during-observation"),
            );
            return readyNpm();
          },
          clock: () => "2026-08-21T03:01:00Z",
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("requires --online before opening any input source", async () => {
    let reads = 0;
    await assert.rejects(
      checkCliFirstPublicationPreflight(
        {
          online: false,
          releaseDirectory: "/release",
          publicationAuthorizationPath: "/publication.json",
          bootstrapPath: "/bootstrap.json",
          reservationRoot: "/reservations",
          userConfigPath: "/user.npmrc",
        },
        {
          readSources: async () => {
            reads += 1;
          },
        },
      ),
      {
        code: "first_publication_preflight_online_required",
      },
    );
    assert.equal(reads, 0);
  });

  it("prints natural Korean boundaries without exposing report internals as authority", () => {
    const report = {
      status: "blocked",
      checks: [
        {
          id: "npm_interactive_readiness",
          status: "blocked",
          reasons: ["terminal_not_interactive"],
        },
      ],
    };
    const output = formatFirstPublicationPreflight(report);
    assert.match(output, /Interactive npm readiness: blocked/u);
    assert.match(output, /not execution authorization/u);
    assert.match(
      output,
      /did not create a reservation, publish a package, or change external configuration/u,
    );
  });

  it("the executable rejects a missing online boundary without network output", () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/release/first-publication/transition/commands/check-cli-first-publication-preflight.mjs",
        "--release-directory",
        "/release",
        "--publication-authorization",
        "/publication.json",
        "--bootstrap",
        "/bootstrap.json",
        "--reservation-root",
        "/reservations",
        "--user-config",
        "/user.npmrc",
        "--json",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^first_publication_preflight_arguments_invalid:/u);
  });
});

describe("npm interactive first-publication observer", () => {
  it("uses isolated read-only npm commands and removes temporary state", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-npm-observer-"));
    try {
      const userConfigPath = resolve(root, "user.npmrc");
      await writeFile(userConfigPath, "//registry.npmjs.org/:_authToken=stored\n");
      const calls = [];
      let temporaryRoot;
      const observation = await observeNpmInteractiveFirstPublication(
        {
          registry: npmPublicRegistry,
          userConfigPath,
        },
        {
          execute: async (_command, args, options) => {
            calls.push(args);
            temporaryRoot = options.cwd;
            assert.equal(options.env.npm_config_registry, undefined);
            assert.equal(options.env.NPM_CONFIG_USERCONFIG, userConfigPath);
            if (args[0] === "--version") return { stdout: "11.17.0\n" };
            return {
              stdout: JSON.stringify({ tfa: { mode: "auth-and-writes", pending: false } }),
            };
          },
          environment: { npm_config_registry: "https://malicious.invalid" },
          stdinIsTTY: true,
          stdoutIsTTY: true,
          stderrIsTTY: true,
        },
      );
      assert.equal(observation.state, "ready");
      assert.deepEqual(calls, [
        ["--version"],
        ["profile", "get", "--registry", npmPublicRegistry, "--json"],
      ]);
      await assert.rejects(lstat(temporaryRoot), { code: "ENOENT" });
      assert.match(await readFile(userConfigPath, "utf8"), /stored/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not run npm or expose credential values in an unsafe environment", async () => {
    const observation = await observeNpmInteractiveFirstPublication(
      {
        registry: npmPublicRegistry,
        userConfigPath: "/missing/user.npmrc",
      },
      {
        execute: async () => assert.fail("npm must not run"),
        environment: { NPM_CONFIG_OTP: "private-otp" },
        stdinIsTTY: true,
        stdoutIsTTY: true,
        stderrIsTTY: true,
      },
    );
    assert.deepEqual(observation.reasons, ["registry_credential_in_environment"]);
    assert.equal(JSON.stringify(observation).includes("private-otp"), false);
  });

  it("reports an unavailable client without copying its error", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-npm-observer-"));
    try {
      const userConfigPath = resolve(root, "user.npmrc");
      await writeFile(userConfigPath, "registry=https://registry.npmjs.org\n");
      const observation = await observeNpmInteractiveFirstPublication(
        {
          registry: npmPublicRegistry,
          userConfigPath,
        },
        {
          execute: async () => {
            throw new Error("private npm failure");
          },
          environment: {},
          stdinIsTTY: true,
          stdoutIsTTY: true,
          stderrIsTTY: true,
        },
      );
      assert.equal(observation.state, "unavailable");
      assert.deepEqual(observation.reasons, ["npm_client_unavailable"]);
      assert.equal(JSON.stringify(observation).includes("private npm failure"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
