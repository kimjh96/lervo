import { chmod } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadNodeRuntimeConfig,
  openNodeRuntime,
  parseNodeRuntimeConfig,
} from "../src/index.js";
import {
  availablePort,
  nodeRuntimeFixture,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("Node runtime configuration", () => {
  it("loads strict owner-only config and resolves project and token paths from that file", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    await expect(loadNodeRuntimeConfig(fixture.configPath)).resolves.toMatchObject({
      repositoryRoot: fixture.repositoryRoot,
      hub: { bearerTokenFile: `${root}/hub.token` },
      sync: { workerId: "node:runtime-test" },
    });

    if (process.platform !== "win32") {
      await chmod(fixture.configPath, 0o644);
      await expect(loadNodeRuntimeConfig(fixture.configPath)).rejects.toMatchObject({
        code: "unsafe_runtime_file",
      });
    }
  });

  it("rejects plaintext Hub URLs, unknown fields, and invalid scheduler bounds", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const plaintext = structuredClone(fixture.value);
    (plaintext.hub as Record<string, unknown>).baseUrl = "http://hub.example.test";
    expect(() => parseNodeRuntimeConfig(plaintext, root)).toThrow(expect.objectContaining({
      code: "invalid_config",
    }));
    expect(() => parseNodeRuntimeConfig({ ...fixture.value, extra: true }, root)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
    const invalidPoll = structuredClone(fixture.value);
    (invalidPoll.sync as Record<string, unknown>).idlePollIntervalMs = 99;
    expect(() => parseNodeRuntimeConfig(invalidPoll, root)).toThrow(expect.objectContaining({
      code: "invalid_config",
    }));

    const direct = await loadNodeRuntimeConfig(fixture.configPath);
    direct.hub.baseUrl = "http://hub.example.test/";
    await expect(openNodeRuntime(direct, {
      createTransport: () => ({
        registerProject: async () => ({}),
        sendEventBatch: async () => ({}),
      }),
    })).rejects.toMatchObject({ code: "invalid_config" });

    const disabledRoot = await temporaryRoot();
    const disabled = await nodeRuntimeFixture(disabledRoot, await availablePort(), {
      hubSyncEnabled: false,
    });
    await expect(openNodeRuntime(await loadNodeRuntimeConfig(disabled.configPath), {
      createTransport: () => ({
        registerProject: async () => ({}),
        sendEventBatch: async () => ({}),
      }),
    })).rejects.toMatchObject({ code: "project_invalid" });
  });

  it("parses scoped trust key files and requires explicit command execution ports", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const configured = structuredClone(fixture.value);
    configured.remoteCommands = {
      nodeId: "node_runtime_control_01",
      commandKeys: [{ keyId: "key_command_runtime_01", publicKeyFile: "keys/command.pem" }],
      policyKeys: [{
        keyId: "key_policy_runtime_01",
        publicKeyFile: "keys/policy.pem",
        purposes: ["snapshot", "approval", "revocation"],
      }],
      idlePollIntervalMs: 100,
      retryDelayMs: 1_000,
    };
    expect(parseNodeRuntimeConfig(configured, root)).toMatchObject({
      remoteCommands: {
        nodeId: "node_runtime_control_01",
        commandKeys: [{ publicKeyFile: `${root}/keys/command.pem` }],
        policyKeys: [{ publicKeyFile: `${root}/keys/policy.pem` }],
      },
    });
    await expect(openNodeRuntime(parseNodeRuntimeConfig(configured, root), {
      createTransport: () => ({
        registerProject: async () => ({}),
        sendEventBatch: async () => ({}),
      }),
    })).rejects.toMatchObject({ code: "invalid_config" });

    const duplicate = structuredClone(configured);
    (duplicate.remoteCommands as Record<string, unknown>).commandKeys = [
      { keyId: "key_command_runtime_01", publicKeyFile: "keys/one.pem" },
      { keyId: "key_command_runtime_01", publicKeyFile: "keys/two.pem" },
    ];
    expect(() => parseNodeRuntimeConfig(duplicate, root)).toThrow(expect.objectContaining({
      code: "invalid_config",
    }));
  });
});
