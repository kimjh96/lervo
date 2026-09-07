import { chmod } from "node:fs/promises";

import { createRemoteDeveloperRole } from "@lervo/managed-provider-host";
import { afterEach, describe, expect, it } from "vitest";

import {
  createManagedProviderRemoteCommandPorts,
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
    expect(() => parseNodeRuntimeConfig(plaintext, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );
    expect(() => parseNodeRuntimeConfig({ ...fixture.value, extra: true }, root)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
    const invalidPoll = structuredClone(fixture.value);
    (invalidPoll.sync as Record<string, unknown>).idlePollIntervalMs = 99;
    expect(() => parseNodeRuntimeConfig(invalidPoll, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );

    const direct = await loadNodeRuntimeConfig(fixture.configPath);
    direct.hub.baseUrl = "http://hub.example.test/";
    await expect(
      openNodeRuntime(direct, {
        createTransport: () => ({
          registerProject: async () => ({}),
          sendEventBatch: async () => ({}),
        }),
      }),
    ).rejects.toMatchObject({ code: "invalid_config" });

    const disabledRoot = await temporaryRoot();
    const disabled = await nodeRuntimeFixture(disabledRoot, await availablePort(), {
      hubSyncEnabled: false,
    });
    await expect(
      openNodeRuntime(await loadNodeRuntimeConfig(disabled.configPath), {
        createTransport: () => ({
          registerProject: async () => ({}),
          sendEventBatch: async () => ({}),
        }),
      }),
    ).rejects.toMatchObject({ code: "project_invalid" });
  });

  it("requires explicit Hub-coordinated workspace mode and a durable Node identity", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const configured = structuredClone(fixture.value);
    configured.workspaceCoordination = {
      mode: "hub_coordinated",
      nodeId: "nod_workspace_node_01",
    };
    expect(parseNodeRuntimeConfig(configured, root)).toMatchObject({
      workspaceCoordination: {
        mode: "hub_coordinated",
        nodeId: "nod_workspace_node_01",
      },
    });
    (configured.workspaceCoordination as Record<string, unknown>).mode = "local_first";
    expect(() => parseNodeRuntimeConfig(configured, root)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
  });

  it("parses bounded Discord conversation scope and owner-only credential paths", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const configured = structuredClone(fixture.value);
    configured.discordConversation = {
      integrationId: "itg_discord01",
      applicationId: "999999999999999999",
      botTokenFile: "discord.token",
      intents: 37_377,
      allowedGuildIds: ["123456789012345678"],
      allowDirectMessages: false,
      workerId: "discord-operator",
      agentParticipantId: "ptc_lervoagent",
      conversations: [
        {
          tenantKey: "123456789012345678",
          conversationKey: "223456789012345678",
          conversationId: "cnv_operator01",
        },
      ],
      participants: [
        {
          tenantKey: "123456789012345678",
          userId: "323456789012345678",
          participantId: "ptc_operator01",
        },
      ],
      command: {
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        lifetimeMs: 120_000,
      },
    };
    expect(parseNodeRuntimeConfig(configured, root)).toMatchObject({
      discordConversation: {
        botTokenFile: `${root}/discord.token`,
        command: { assignmentId: null, agentId: null },
      },
    });
    const unscoped = structuredClone(configured);
    (unscoped.discordConversation as { allowedGuildIds: string[] }).allowedGuildIds = [];
    expect(() => parseNodeRuntimeConfig(unscoped, root)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
  });

  it("binds organization credential delivery to one explicit organization Node identity", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const configured = structuredClone(fixture.value);
    configured.organizationCredentials = { nodeId: "node_organization01" };
    expect(parseNodeRuntimeConfig(configured, root)).toMatchObject({
      organizationCredentials: { nodeId: "node_organization01" },
    });
    (configured.organizationCredentials as Record<string, unknown>).nodeId = "nod_local_01";
    expect(() => parseNodeRuntimeConfig(configured, root)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
  });

  it("parses scoped trust key files and requires explicit command execution ports", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const configured = structuredClone(fixture.value);
    configured.remoteCommands = {
      nodeId: "node_runtime_control_01",
      commandKeys: [{ keyId: "key_command_runtime_01", publicKeyFile: "keys/command.pem" }],
      policyKeys: [
        {
          keyId: "key_policy_runtime_01",
          publicKeyFile: "keys/policy.pem",
          purposes: ["snapshot", "approval", "revocation"],
        },
      ],
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
    const external = structuredClone(configured);
    delete (external.remoteCommands as Record<string, unknown>).commandKeys;
    delete (external.remoteCommands as Record<string, unknown>).policyKeys;
    (external.remoteCommands as Record<string, unknown>).trustFile = "secrets/node-trust.json";
    expect(parseNodeRuntimeConfig(external, root)).toMatchObject({
      remoteCommands: { trustFile: `${root}/secrets/node-trust.json` },
    });
    const mixed = structuredClone(configured);
    (mixed.remoteCommands as Record<string, unknown>).trustFile = "secrets/node-trust.json";
    expect(() => parseNodeRuntimeConfig(mixed, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );
    const hosted = structuredClone(configured);
    (hosted.remoteCommands as Record<string, unknown>).providerHost = {
      providers: ["codex", "claude"],
      roles: ["developer"],
      developerSkills: [],
      executables: { codex: "/opt/lervo/bin/codex" },
    };
    expect(parseNodeRuntimeConfig(hosted, root)).toMatchObject({
      remoteCommands: {
        providerHost: {
          providers: ["codex", "claude"],
          roles: ["developer"],
          developerSkills: [],
          executables: { codex: "/opt/lervo/bin/codex" },
        },
      },
    });
    const unregistered = structuredClone(hosted);
    (unregistered.remoteCommands as Record<string, unknown>).providerHost = {
      providers: ["codex"],
      roles: ["unregistered"],
      developerSkills: [],
    };
    expect(() =>
      createManagedProviderRemoteCommandPorts(parseNodeRuntimeConfig(unregistered, root)),
    ).toThrow(expect.objectContaining({ code: "invalid_config" }));
    await expect(
      openNodeRuntime(parseNodeRuntimeConfig(configured, root), {
        createTransport: () => ({
          registerProject: async () => ({}),
          sendEventBatch: async () => ({}),
        }),
      }),
    ).rejects.toMatchObject({ code: "invalid_config" });

    const duplicate = structuredClone(configured);
    (duplicate.remoteCommands as Record<string, unknown>).commandKeys = [
      { keyId: "key_command_runtime_01", publicKeyFile: "keys/one.pem" },
      { keyId: "key_command_runtime_01", publicKeyFile: "keys/two.pem" },
    ];
    expect(() => parseNodeRuntimeConfig(duplicate, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );
    const invalidHost = structuredClone(hosted);
    (invalidHost.remoteCommands as Record<string, unknown>).providerHost = {
      providers: ["codex", "codex"],
      roles: ["developer"],
      developerSkills: [],
    };
    expect(() => parseNodeRuntimeConfig(invalidHost, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );
    const detachedExecutable = structuredClone(hosted);
    (detachedExecutable.remoteCommands as Record<string, unknown>).providerHost = {
      providers: ["claude"],
      roles: ["developer"],
      developerSkills: [],
      executables: { codex: "/opt/lervo/bin/codex" },
    };
    expect(() => parseNodeRuntimeConfig(detachedExecutable, root)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
    const relativeExecutable = structuredClone(hosted);
    (relativeExecutable.remoteCommands as Record<string, unknown>).providerHost = {
      providers: ["codex"],
      roles: ["developer"],
      developerSkills: [],
      executables: { codex: "bin/codex" },
    };
    expect(() => parseNodeRuntimeConfig(relativeExecutable, root)).toThrow(
      expect.objectContaining({ code: "invalid_config" }),
    );
    const invalidRoles = structuredClone(hosted);
    (invalidRoles.remoteCommands as Record<string, unknown>).providerHost = {
      providers: ["codex"],
      roles: ["developer", "developer"],
      developerSkills: [],
    };
    expect(() => parseNodeRuntimeConfig(invalidRoles, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );
    const invalidSkills = structuredClone(hosted);
    (invalidSkills.remoteCommands as Record<string, unknown>).providerHost = {
      providers: ["codex"],
      roles: ["developer"],
      developerSkills: ["repository/testing", "repository/testing"],
    };
    expect(() => parseNodeRuntimeConfig(invalidSkills, root)).toThrow(
      expect.objectContaining({
        code: "invalid_config",
      }),
    );
    const detachedDeveloperSkills = structuredClone(hosted);
    (detachedDeveloperSkills.remoteCommands as Record<string, unknown>).providerHost = {
      providers: ["codex"],
      roles: ["maintainer"],
      developerSkills: ["repository/testing"],
    };
    expect(() =>
      createManagedProviderRemoteCommandPorts(
        parseNodeRuntimeConfig(detachedDeveloperSkills, root),
        {
          roleProfiles: [
            {
              ...createRemoteDeveloperRole(["repo.check"]),
              roleId: "maintainer",
            },
          ],
        },
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_config" }));
  });
});
