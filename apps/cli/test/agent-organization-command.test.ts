import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

describe("agent organization CLI", () => {
  it("idempotently binds a hired Discord agent and channel to one repository team", async () => {
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
    const first: string[] = [];
    expect(await runCli(bind, io(root, first))).toBe(0);
    expect(JSON.parse(first.join(""))).toMatchObject({
      team: { organizationId: "org_lervoowner01", teamId: "team_lervocore01" },
      memberships: [{ agentId, status: "active" }],
      deployments: [{ agentId, participantId: "ptc_lervoagent01", retiredAt: null }],
      channelMemberships: [{ conversationId: "cnv_lervogeneral01", status: "active" }],
    });
    expect(await runCli(bind, io(root))).toBe(0);
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
      ]);
      expect(JSON.stringify(organizationEvents)).not.toContain("999999999999999999");
      expect(JSON.stringify(organizationEvents)).not.toContain("222222222222222222");
    } finally {
      await storage.close();
    }
  });
});
