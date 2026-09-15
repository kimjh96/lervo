import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { FileSystemCas } from "@lervo/cas";
import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { parseSupervisionStartupConfiguration } from "../src/supervision-startup-config.js";
import { openNodeSupervisionService } from "../src/supervision-startup.js";
import { openDeploymentSupervision } from "../src/deployment-supervision.js";
import type { NodeRuntimeConfig, NodeDiscordConversationConfig } from "../src/config-types.js";
import type { NodeDiscordConversationRuntime } from "../src/discord-conversation-runtime-types.js";
import type { NodeRuntimeHealthPublisher } from "../src/health.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import type { NodeRuntimeComponentHealth } from "../src/health-contract.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const f = await supervisionFixture(roots, undefined, "developer", ["allocate_existing"]);
  const login = await createLoginFixture(roots);
  const configuration = {
    binding: f.binding,
    runtimeReadiness: {
      providerExecutables: { codex: login.executable },
      providerLoginContexts: { codex: login.context },
      verificationTools: {},
      workerWorkspace: {
        parentDirectory: resolve(f.root, "workers"),
        baseCommit: "a".repeat(40),
        integrationTargetDigest: `sha256:${"b".repeat(64)}`,
      },
    },
    ownerReasoning: { provider: "codex" as const, reservedTokens: 100 },
    managedExecution: {
      nodeExecutable: process.execPath,
      cliBundle: resolve("apps/cli/dist/bin.js"),
    },
  };
  return { f, configuration };
}
it("carries a declared goal command announcement and rejects an ill-formed declaration", async () => {
  const { configuration } = await fixture();
  expect(
    parseSupervisionStartupConfiguration({ ...configuration, goalCommand: { announce: true } })
      .goalCommand,
  ).toEqual({ announce: true });
  // An absent declaration stays absent: a deployment advertises `/goal` only when it says so.
  expect(parseSupervisionStartupConfiguration({ ...configuration }).goalCommand).toBeUndefined();
  expect(() =>
    parseSupervisionStartupConfiguration({ ...configuration, goalCommand: { announce: "yes" } }),
  ).toThrow(/announcement must be declared as a boolean/u);
  expect(() =>
    parseSupervisionStartupConfiguration({
      ...configuration,
      goalCommand: { announce: true, guilds: [] },
    }),
  ).toThrow();
});

it("snapshots exact startup authority and rejects unknown fields or mismatched transport origin", async () => {
  const { f, configuration } = await fixture();
  const parsed = parseSupervisionStartupConfiguration(configuration);
  configuration.binding.ownerAgentId = `agt_${"a".repeat(24)}`;
  expect(parsed.binding.ownerAgentId).not.toBe(configuration.binding.ownerAgentId);
  expect(() => parseSupervisionStartupConfiguration({ ...parsed, approve: true })).toThrow(
    /unknown fields/iu,
  );
  const resultOrigin = {
    sourceEventId: `cve_${"3".repeat(64)}`,
    policyId: `cpp_${"4".repeat(64)}`,
    target: {
      integrationId: "itg_startupresult",
      projectId: f.owner.projectId,
      conversationId: "cnv_startupresult",
      threadId: "thd_startupthread",
    },
    actor: { kind: "agent" as const, participantId: "ptc_startupowner", roleId: f.owner.roleId },
  };
  expect(parseSupervisionStartupConfiguration({ ...parsed, resultOrigin }).resultOrigin).toEqual(
    resultOrigin,
  );
  const { binding: root, ...rest } = configuration;
  const standing = parseSupervisionStartupConfiguration({ ...rest, standing: root });
  expect(standing).toMatchObject({ binding: root, standing: true });
  expect(parseSupervisionStartupConfiguration(standing)).toEqual(standing);
  expect(() => parseSupervisionStartupConfiguration({ ...configuration, standing: root })).toThrow(
    /exactly one/iu,
  );
  expect(() => parseSupervisionStartupConfiguration(rest)).toThrow(/exactly one/iu);
  await expect(
    openNodeSupervisionService({
      repositoryRoot: f.root,
      configuration: { ...parsed, resultOrigin },
      observeHealth: async () => undefined,
    }),
  ).rejects.toThrow(/exact configured/iu);
  await expect(
    openNodeSupervisionService({
      repositoryRoot: f.root,
      configuration,
      observeHealth: async () => undefined,
    }),
  ).rejects.toThrow(/binding_invalid/iu);
});
it("starts and closes the local service without a Hub and observes unavailable work without launching a provider", async () => {
  const { f, configuration } = await fixture();
  const health: NodeRuntimeComponentHealth[] = [];
  const service = await openNodeSupervisionService({
    repositoryRoot: f.root,
    configuration,
    observeHealth: async (observation) => {
      health.push(observation);
    },
  });
  try {
    service.start();
    service.start();
    await vi.waitFor(() => expect(health.length).toBeGreaterThan(0), { timeout: 10000 });
  } finally {
    await service.close();
  }
  const unavailable = health.filter((observation) => observation.status === "unavailable");
  expect(unavailable.length).toBeGreaterThan(0);
  for (const observation of unavailable) {
    expect(observation).toMatchObject({ failureCode: "supervision_attention_required" });
    expect(observation.reasonCodes).toBeDefined();
    expect(observation.reasonCodes!.length).toBeGreaterThan(0);
    for (const code of observation.reasonCodes!) expect(code).toMatch(/^[a-z][a-z0-9_]{0,63}$/u);
  }
  const storage = await openProjectStorage(f.root);
  try {
    const source = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
    expect(source.events.filter((event) => event.type === "adapter.started")).toHaveLength(0);
    expect(source.assignments).toHaveLength(0);
  } finally {
    await storage.close();
  }
  expect(() => service.start()).toThrow(/closed/iu);
});

it("uses the durable owner's role for a configured Discord result speaker", async () => {
  const { f, configuration } = await fixture();
  const conversation = {
    agentId: f.owner.agentId,
    agentParticipantId: "ptc_startupowner",
    integrationId: "itg_startupresult",
    command: { agentId: null, roleId: "researcher", provider: "codex" },
    conversations: [{ conversationId: "cnv_startupresult" }],
  } as unknown as NodeDiscordConversationConfig;
  const config = {
    repositoryRoot: f.root,
    discordConversation: conversation,
    outcomeSupervision: {
      ...configuration,
      resultOrigin: {
        sourceEventId: `cve_${"3".repeat(64)}`,
        policyId: `cpp_${"4".repeat(64)}`,
        target: {
          integrationId: conversation.integrationId,
          projectId: f.owner.projectId,
          conversationId: "cnv_startupresult",
          threadId: null,
        },
        actor: {
          kind: "agent" as const,
          participantId: conversation.agentParticipantId,
          roleId: f.owner.roleId,
        },
      },
    },
  } as NodeRuntimeConfig;
  const artifacts = await FileSystemCas.open(resolve(f.root, "fixture-conversation-artifacts"));
  const service = await openDeploymentSupervision({
    config,
    projectId: f.owner.projectId,
    conversation: {
      resultAdapter: () => ({ descriptor: { integrationId: "itg_startupresult" } }),
      resultArtifacts: () => artifacts,
      resultReplay: () => "absent",
    } as unknown as NodeDiscordConversationRuntime,
    health: { observeSupervision: async () => undefined } as unknown as NodeRuntimeHealthPublisher,
  });
  expect(service).not.toBeNull();
  await service!.close();
});
