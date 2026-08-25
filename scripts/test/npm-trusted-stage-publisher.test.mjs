import assert from "node:assert/strict";
import { access } from "node:fs/promises";

import { describe, it } from "vitest";

import { prepareNpmTrustedStagePublisher } from "../lib/npm-trusted-stage-publisher.mjs";
import { npmPublicRegistry } from "../lib/release-publication-authorization.mjs";

const environment = {
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.test/request",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "ephemeral-oidc-request-token",
};
const input = {
  target: {
    registry: npmPublicRegistry,
    package: "@lervo/cli",
    version: "0.1.0",
    distTag: "latest",
    access: "public",
  },
  artifact: {
    file: "lervo-cli-0.1.0.tgz",
    sha256: "a".repeat(64),
    registryIntegrity: `sha512-${"A".repeat(86)}==`,
    registryShasum: "b".repeat(40),
  },
  tarballPath: "/tmp/lervo-cli-0.1.0.tgz",
};

describe("npm trusted stage publisher adapter", () => {
  it("uses npm stage publish once and reports only CLI exit-zero evidence", async () => {
    const calls = [];
    const execute = async (_command, args, options) => {
      calls.push({ args, options });
      if (args[0] === "--version") return { stdout: "11.18.0\n", stderr: "" };
      return { stdout: "staged\n", stderr: "" };
    };
    const prepared = await prepareNpmTrustedStagePublisher(input, {
      environment: { ...environment, NPM_CONFIG_DRY_RUN: "true" },
      execute,
      nodeVersion: "v22.14.0",
    });
    const receipt = await prepared.stage();
    assert.deepEqual(calls[1].args, [
      "stage",
      "publish",
      input.tarballPath,
      "--registry",
      npmPublicRegistry,
      "--tag",
      "latest",
      "--access",
      "public",
      "--ignore-scripts",
    ]);
    assert.equal(receipt.status, "stage_submission_accepted");
    assert.equal(receipt.evidence, "npm_cli_exit_zero");
    assert.equal("stageId" in receipt, false);
    assert.equal("NPM_CONFIG_DRY_RUN" in calls[1].options.env, false);
    await assert.rejects(prepared.stage(), {
      code: "npm_stage_publication_reuse_forbidden",
    });
    const isolationRoot = calls[1].options.cwd;
    await prepared.dispose();
    await assert.rejects(access(isolationRoot));
  });

  it("rejects credentials and pre-stage clients before an external write", async () => {
    let calls = 0;
    const execute = async () => {
      calls += 1;
      return { stdout: "11.18.0\n", stderr: "" };
    };
    await assert.rejects(
      prepareNpmTrustedStagePublisher(input, {
        environment: { ...environment, NPM_TOKEN: "long-lived" },
        execute,
        nodeVersion: "v22.14.0",
      }),
      { code: "npm_trusted_publishing_environment_invalid" },
    );
    assert.equal(calls, 0);
    await assert.rejects(
      prepareNpmTrustedStagePublisher(input, {
        environment,
        execute: async () => ({ stdout: "11.14.0\n", stderr: "" }),
        nodeVersion: "v22.14.0",
      }),
      { code: "npm_trusted_publishing_client_invalid" },
    );
  });

  it("classifies any error after npm stage starts as an unknown outcome", async () => {
    const prepared = await prepareNpmTrustedStagePublisher(input, {
      environment,
      execute: async (_command, args) => {
        if (args[0] === "--version") return { stdout: "11.15.0\n", stderr: "" };
        throw new Error("connection closed after request");
      },
      nodeVersion: "v24.0.0",
    });
    await assert.rejects(prepared.stage(), {
      code: "npm_stage_publication_outcome_unknown",
    });
    await prepared.dispose();
  });
});
