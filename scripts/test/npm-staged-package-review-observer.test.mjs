import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { observeNpmStagedPackageReview } from
  "../lib/npm-staged-package-review-observer.mjs";
import {
  createReleasePublicationArtifact,
  npmPublicRegistry,
} from "../lib/release-publication-authorization.mjs";

const version = "0.1.0";
const stageId = "123e4567-e89b-42d3-a456-426614174000";
const tarball = Buffer.from("first-publication-fixture-tarball");
const artifact = createReleasePublicationArtifact(`lervo-cli-${version}.tgz`, version, tarball);

function stage(overrides = {}) {
  return {
    id: stageId,
    packageName: "@lervo/cli",
    version,
    tag: "latest",
    createdAt: "2026-08-21T10:11:00Z",
    actor: { name: "private-user" },
    actorType: "user",
    shasum: artifact.registryShasum,
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-stage-review-test-"));
  const userConfigPath = resolve(root, "user.npmrc");
  await writeFile(userConfigPath, "//registry.npmjs.org/:_authToken=fixture\n");
  return { root, userConfigPath };
}

function input(userConfigPath) {
  return {
    registry: npmPublicRegistry,
    packageName: "@lervo/cli",
    version,
    expectedArtifact: artifact,
    userConfigPath,
  };
}

describe("npm staged package review observer", () => {
  it("uses only list/view/download, binds the tarball, and removes private temporary data", async () => {
    const files = await fixture();
    const commands = [];
    let temporaryDirectory;
    try {
      const execute = async (_command, args, options) => {
        commands.push(args);
        temporaryDirectory = options.cwd;
        assert.equal(options.env.NPM_CONFIG_USERCONFIG, files.userConfigPath);
        assert.equal(options.env.npm_config_token, undefined);
        if (args[0] === "--version") return { stdout: "11.18.0\n", stderr: "" };
        if (args[1] === "list") {
          return { stdout: JSON.stringify([stage()]), stderr: "private stderr" };
        }
        if (args[1] === "view") return { stdout: JSON.stringify(stage()), stderr: "" };
        if (args[1] === "download") {
          await writeFile(resolve(options.cwd, `lervo-cli-${version}-${stageId}.tgz`), tarball);
          return { stdout: "{}\n", stderr: "" };
        }
        throw new Error("unexpected command");
      };
      const observation = await observeNpmStagedPackageReview(input(files.userConfigPath), {
        execute,
        environment: { PATH: process.env.PATH, npm_config_loglevel: "verbose" },
        npmCommand: "/fixture/npm",
      });
      assert.equal(observation.state, "observed");
      assert.equal(observation.tarball.sha256, artifact.sha256);
      assert.equal(observation.stage.shasum, artifact.registryShasum);
      assert.equal(JSON.stringify(observation).includes(stageId), false);
      assert.equal(JSON.stringify(observation).includes("private-user"), false);
      assert.deepEqual(commands.map((args) => args.slice(0, 2)), [
        ["--version"], ["stage", "list"], ["stage", "view"],
        ["stage", "download"], ["stage", "view"],
      ]);
      assert.equal(commands.flat().some((value) => ["approve", "reject"].includes(value)), false);
      await assert.rejects(access(temporaryDirectory));
    } finally {
      await rm(files.root, { recursive: true, force: true });
    }
  });

  it("fails closed for duplicate exact stages, changed metadata, and tarball mismatch", async () => {
    for (const scenario of ["duplicate", "changed", "tarball"]) {
      const files = await fixture();
      let viewCount = 0;
      try {
        const execute = async (_command, args, options) => {
          if (args[0] === "--version") return { stdout: "11.18.0\n" };
          if (args[1] === "list") {
            return { stdout: JSON.stringify(scenario === "duplicate"
              ? [stage(), stage({ id: "223e4567-e89b-42d3-a456-426614174000" })]
              : [stage()]) };
          }
          if (args[1] === "view") {
            viewCount += 1;
            return { stdout: JSON.stringify(
              scenario === "changed" && viewCount === 2
                ? stage({ createdAt: "2026-08-21T10:12:00Z" })
                : stage(),
            ) };
          }
          if (args[1] === "download") {
            await writeFile(
              resolve(options.cwd, `lervo-cli-${version}-${stageId}.tgz`),
              scenario === "tarball" ? Buffer.from("different") : tarball,
            );
            return { stdout: "{}\n" };
          }
          throw new Error("unexpected command");
        };
        const result = await observeNpmStagedPackageReview(input(files.userConfigPath), {
          execute,
          environment: { PATH: process.env.PATH },
        });
        assert.equal(result.state, "unavailable");
        assert.equal(result.reason, {
          duplicate: "stage_ambiguous",
          changed: "stage_changed",
          tarball: "tarball_mismatch",
        }[scenario]);
      } finally {
        await rm(files.root, { recursive: true, force: true });
      }
    }
  });

  it("rejects ambient credentials before invoking npm", async () => {
    const files = await fixture();
    try {
      let called = false;
      const result = await observeNpmStagedPackageReview(input(files.userConfigPath), {
        execute: async () => { called = true; },
        environment: { NPM_TOKEN: "secret" },
      });
      assert.equal(result.reason, "environment_invalid");
      assert.equal(called, false);
    } finally {
      await rm(files.root, { recursive: true, force: true });
    }
  });
});
