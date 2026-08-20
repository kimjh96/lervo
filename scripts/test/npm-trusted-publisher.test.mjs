import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { describe, it } from "vitest";

import { createNpmTrustedPublisher } from "../lib/npm-trusted-publisher.mjs";
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

describe("npm trusted publisher adapter", () => {
  it("uses only the exact authorized publish coordinates and verifies registry state", async () => {
    const calls = [];
    const execute = async (_command, args, options) => {
      calls.push({ args, options });
      if (args[0] === "--version") return { stdout: "11.17.0\n", stderr: "" };
      if (args[0] === "publish") return { stdout: "+ @lervo/cli@0.1.0\n", stderr: "" };
      if (args[2] === "dist") {
        return { stdout: JSON.stringify({
          integrity: input.artifact.registryIntegrity,
          shasum: input.artifact.registryShasum,
        }), stderr: "" };
      }
      return { stdout: JSON.stringify({ latest: "0.1.0" }), stderr: "" };
    };
    const publish = createNpmTrustedPublisher({
      environment,
      execute,
      nodeVersion: "v22.14.0",
    });
    const receipt = await publish(input);
    assert.equal(receipt.registryIntegrity, input.artifact.registryIntegrity);
    assert.deepEqual(calls[1].args, [
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
    assert.notEqual(calls[1].options.cwd, process.cwd());
    assert.equal(
      calls[1].options.env.NPM_CONFIG_USERCONFIG.startsWith(calls[1].options.cwd),
      true,
    );
    assert.equal(
      calls[1].options.env.NPM_CONFIG_GLOBALCONFIG.startsWith(calls[1].options.cwd),
      true,
    );
    await assert.rejects(access(calls[1].options.cwd));
  });

  it("rejects long-lived tokens and unsupported runtime clients before publish", async () => {
    let calls = 0;
    const execute = async () => {
      calls += 1;
      return { stdout: "11.17.0\n", stderr: "" };
    };
    await assert.rejects(
      createNpmTrustedPublisher({
        environment: { ...environment, NODE_AUTH_TOKEN: "persistent-token" },
        execute,
        nodeVersion: "v22.14.0",
      })(input),
      { code: "npm_trusted_publishing_environment_invalid" },
    );
    await assert.rejects(
      createNpmTrustedPublisher({
        environment,
        execute,
        nodeVersion: "v22.13.0",
      })(input),
      { code: "npm_trusted_publishing_environment_invalid" },
    );
    await assert.rejects(
      createNpmTrustedPublisher({
        environment,
        execute: async () => ({ stdout: "11.5.0\n", stderr: "" }),
        nodeVersion: "v22.14.0",
      })(input),
      { code: "npm_trusted_publishing_client_invalid" },
    );
    assert.equal(calls, 0);
  });

  it("does not report success when registry metadata differs", async () => {
    const execute = async (_command, args) => {
      if (args[0] === "--version") return { stdout: "11.5.1\n", stderr: "" };
      if (args[0] === "publish") return { stdout: "published\n", stderr: "" };
      if (args[2] === "dist") {
        return { stdout: JSON.stringify({
          integrity: `sha512-${"B".repeat(86)}==`,
          shasum: input.artifact.registryShasum,
        }), stderr: "" };
      }
      return { stdout: JSON.stringify({ latest: "0.1.0" }), stderr: "" };
    };
    await assert.rejects(
      createNpmTrustedPublisher({
        environment,
        execute,
        nodeVersion: "v24.0.0",
      })(input),
      { code: "npm_publication_verification_failed" },
    );
  });
});
