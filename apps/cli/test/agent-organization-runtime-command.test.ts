import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

function io(cwd: string, stdout: string[] = []) {
  return {
    cwd,
    stdout: (message: string) => stdout.push(message),
    stderr: () => undefined,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createRuntimeFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-organization-"));
  roots.push(root);
  expect(await runCli(["init", "--root", root, "--name", "organization-fixture"], io(root))).toBe(
    0,
  );
  const hireOutput: string[] = [];
  expect(
    await runCli(
      [
        "agent",
        "hire",
        "--role",
        "developer",
        "--name",
        "Nova",
        "--provider",
        "any",
        "--write",
        "--root",
        root,
        "--json",
      ],
      io(root, hireOutput),
    ),
  ).toBe(0);
  const agentId = JSON.parse(hireOutput.join("")).agentId as string;
  const configPath = resolve(root, "node-config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      repositoryRoot: ".",
      hub: {
        baseUrl: "https://hub.example.test/",
        bearerTokenFile: "hub.token",
        destinationId: "hub:organization-test",
        hubIdentityHash: `sha256:${"a".repeat(64)}`,
      },
      sync: { workerId: "organization-sync" },
      discordConversation: {
        integrationId: "itg_discord01",
        applicationId: "999999999999999999",
        botTokenFile: "discord.token",
        intents: 37_377,
        allowedGuildIds: ["111111111111111111"],
        allowDirectMessages: false,
        workerId: "organization-discord",
        agentParticipantId: "ptc_lervoagent01",
        agentId,
        conversations: [
          {
            tenantKey: "111111111111111111",
            conversationKey: "222222222222222222",
            conversationId: "cnv_lervogeneral01",
          },
        ],
        participants: [
          {
            tenantKey: "111111111111111111",
            userId: "333333333333333333",
            participantId: "ptc_humanowner01",
          },
        ],
        routing: {
          readOnlyRoleId: "conversation-reader",
          intent: { provider: "claude", model: "claude-haiku" },
          response: { provider: "codex", model: "gpt-response" },
        },
        command: {
          roleId: "developer",
          provider: "claude",
          risk: "medium",
          verificationSuiteIds: ["repository.default"],
          lifetimeMs: 120_000,
        },
      },
    }),
    { mode: 0o600 },
  );
  const bind = [
    "organization",
    "bind-runtime",
    "--organization",
    "org_lervoowner01",
    "--team",
    "team_lervocore01",
    "--config",
    configPath,
    "--write",
    "--root",
    root,
    "--json",
  ];
  return { root, agentId, configPath, bind };
}

async function appendHistoricalRuns(root: string) {
  const historicalStorage = await openProjectStorage(root);
  try {
    for (let index = 0; index < 1_001; index += 1) {
      historicalStorage.events.append({
        schemaVersion: 1,
        eventId: `evt_org_history_${String(index).padStart(8, "0")}`,
        projectId: historicalStorage.manifest.projectId,
        runId: `run_org_history_${String(index).padStart(8, "0")}`,
        sessionId: `ses_org_history_${String(index).padStart(8, "0")}`,
        type: "run.requested",
        occurredAt: new Date(Date.parse("2026-09-08T00:00:00.000Z") + index).toISOString(),
        actor: { kind: "user" },
        policyVersion: `sha256:${"a".repeat(64)}`,
        payload: {
          requestDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
          role: "developer",
          risk: "low",
        },
      });
    }
  } finally {
    await historicalStorage.close();
  }
}

describe("agent organization runtime CLI", () => {
  it("replays more than one event page when binding a hired Discord agent", async () => {
    const { root, agentId, bind } = await createRuntimeFixture();
    await appendHistoricalRuns(root);
    const first: string[] = [];
    expect(await runCli(bind, io(root, first))).toBe(0);
    expect(JSON.parse(first.join(""))).toMatchObject({
      team: { organizationId: "org_lervoowner01", teamId: "team_lervocore01" },
      memberships: [{ agentId, agentDisplayName: "Nova", roleId: "developer", status: "active" }],
      deployments: [
        {
          agentId,
          agentDisplayName: "Nova",
          participantId: "ptc_lervoagent01",
          retiredAt: null,
        },
      ],
      channelMemberships: [{ conversationId: "cnv_lervogeneral01", status: "active" }],
    });
    const storage = await openProjectStorage(root);
    try {
      const firstPage = storage.events.list({ afterSeq: 0, limit: 1_000 });
      expect(firstPage).toHaveLength(1_000);
      const nextPage = storage.events.list({ afterSeq: firstPage.at(-1)!.seq, limit: 100 });
      expect(nextPage.some((event) => event.type === "organization.team.bound")).toBe(true);
    } finally {
      await storage.close();
    }
  }, 15_000);

  it("synchronizes identity, runtime rotations, and role changes without leaking credentials", async () => {
    const { root, agentId, configPath, bind } = await createRuntimeFixture();
    expect(await runCli(bind, io(root))).toBe(0);
    expect(
      await runCli(
        [
          "agent",
          "rename",
          "--agent",
          agentId,
          "--name",
          "Tarin",
          "--revision",
          "1",
          "--write",
          "--root",
          root,
        ],
        io(root),
      ),
    ).toBe(0);
    const synchronized: string[] = [];
    expect(await runCli(bind, io(root, synchronized))).toBe(0);
    expect(JSON.parse(synchronized.join(""))).toMatchObject({
      memberships: [{ agentId, agentDisplayName: "Tarin", displayNameRevision: 2 }],
      deployments: [{ agentId, agentDisplayName: "Tarin", displayNameRevision: 2 }],
    });
    const boundDeployment = JSON.parse(synchronized.join("")).deployments[0];
    const changedConfig = JSON.parse(await readFile(configPath, "utf8"));
    // ADR-0612: the deployment no longer covers the response model, so changing it keeps the
    // deployment and its channel membership; the model selection chooses models at call time.
    changedConfig.discordConversation.routing.response.model = "gpt-faster-response";
    await writeFile(configPath, JSON.stringify(changedConfig), { mode: 0o600 });
    const modelChanged: string[] = [];
    expect(await runCli(bind, io(root, modelChanged))).toBe(0);
    const modelProjection = JSON.parse(modelChanged.join(""));
    expect(modelProjection.deployments).toEqual([
      expect.objectContaining({ deploymentId: boundDeployment.deploymentId, retiredAt: null }),
    ]);
    expect(modelProjection.channelMemberships).toEqual([
      expect.objectContaining({ status: "active", revision: 1 }),
    ]);
    changedConfig.discordConversation.speaker = {
      kind: "webhook",
      webhooks: [
        {
          channelId: "222222222222222222",
          webhookId: "444444444444444444",
          tokenFile: "/private/discord-webhook.token",
        },
      ],
    };
    await writeFile(configPath, JSON.stringify(changedConfig), { mode: 0o600 });
    const webhookRotation: string[] = [];
    expect(await runCli(bind, io(root, webhookRotation))).toBe(0);
    const webhookProjection = JSON.parse(webhookRotation.join(""));
    // A new speaker principal still rotates the deployment and ends its channel membership.
    expect(
      webhookProjection.deployments.filter(
        (item: { retiredAt: string | null }) => item.retiredAt === null,
      ),
    ).toEqual([expect.objectContaining({ agentId, agentDisplayName: "Tarin" })]);
    expect(
      webhookProjection.deployments.filter(
        (item: { retiredAt: string | null }) => item.retiredAt !== null,
      ),
    ).toHaveLength(1);
    expect(webhookProjection.channelMemberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "ended", revision: 2 }),
        expect.objectContaining({ status: "active", revision: 1 }),
      ]),
    );
    expect(await runCli(bind, io(root))).toBe(0);
    expect(
      await runCli(
        [
          "agent",
          "status",
          "--agent",
          agentId,
          "--status",
          "suspended",
          "--revision",
          "2",
          "--write",
          "--root",
          root,
        ],
        io(root),
      ),
    ).toBe(0);
    expect(
      await runCli(
        [
          "agent",
          "role",
          "--agent",
          agentId,
          "--role",
          "ceo",
          "--revision",
          "3",
          "--write",
          "--root",
          root,
        ],
        io(root),
      ),
    ).toBe(0);
    expect(
      await runCli(
        [
          "agent",
          "status",
          "--agent",
          agentId,
          "--status",
          "active",
          "--revision",
          "4",
          "--write",
          "--root",
          root,
        ],
        io(root),
      ),
    ).toBe(0);
    const roleSynchronized: string[] = [];
    expect(await runCli(bind, io(root, roleSynchronized))).toBe(0);
    const roleProjection = JSON.parse(roleSynchronized.join(""));
    expect(roleProjection.memberships).toEqual([
      expect.objectContaining({
        agentId,
        agentDisplayName: "Tarin",
        roleId: "ceo",
        status: "active",
        revision: 2,
      }),
    ]);
    expect(roleProjection.deployments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: "developer", retiredAt: expect.any(String) }),
        expect.objectContaining({ roleId: "ceo", retiredAt: null }),
      ]),
    );
    expect(changedConfig.discordConversation.command.roleId).toBe("developer");
    const storage = await openProjectStorage(root);
    try {
      const organizationEvents: ReturnType<typeof storage.events.list> = [];
      let afterSeq = 0;
      while (true) {
        const page = storage.events.list({ afterSeq, limit: 1_000 });
        for (const event of page) {
          afterSeq = event.seq;
          if (event.type.startsWith("organization.")) organizationEvents.push(event);
        }
        if (page.length < 1_000) break;
      }
      expect(organizationEvents.map((event) => event.type)).toEqual([
        "organization.team.bound",
        "organization.agent.membership.changed",
        "organization.external_agent.deployment.bound",
        "organization.channel.membership.changed",
        "organization.agent.identity.changed",
        "organization.channel.membership.changed",
        "organization.external_agent.deployment.retired",
        "organization.external_agent.deployment.bound",
        "organization.channel.membership.changed",
        "organization.channel.membership.changed",
        "organization.external_agent.deployment.retired",
        "organization.agent.membership.changed",
        "organization.external_agent.deployment.bound",
        "organization.channel.membership.changed",
      ]);
      expect(JSON.stringify(organizationEvents)).not.toContain("999999999999999999");
      expect(JSON.stringify(organizationEvents)).not.toContain("222222222222222222");
      expect(JSON.stringify(organizationEvents)).not.toContain("444444444444444444");
    } finally {
      await storage.close();
    }
  }, 15_000);
});
