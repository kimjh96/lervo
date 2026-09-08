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
  it("reclassifies an exact existing team with an auditable revision", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-team-kind-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "team-kind"], io(root))).toBe(0);
    const coordinates = [
      "--organization",
      "org_lervoowner01",
      "--team",
      "team_lervocore01",
      "--root",
      root,
    ];
    expect(
      await runCli(
        ["organization", "bind-team", ...coordinates, "--kind", "project", "--write"],
        io(root),
      ),
    ).toBe(0);
    expect(
      await runCli(
        ["organization", "set-team-kind", ...coordinates, "--kind", "central", "--write"],
        io(root),
      ),
    ).toBe(0);
    const output: string[] = [];
    expect(
      await runCli(["organization", "inspect", "--root", root, "--json"], io(root, output)),
    ).toBe(0);
    expect(JSON.parse(output.join(""))).toMatchObject({
      team: { organizationId: "org_lervoowner01", teamKind: "central" },
      teamKindRevision: 2,
    });
  });

  it("composes central and project repositories and evaluates a bounded CEO request", async () => {
    const central = await mkdtemp(resolve(tmpdir(), "lervo-central-organization-"));
    const project = await mkdtemp(resolve(tmpdir(), "lervo-project-organization-"));
    roots.push(central, project);
    expect(await runCli(["init", "--root", central, "--name", "central"], io(central))).toBe(0);
    expect(await runCli(["init", "--root", project, "--name", "project"], io(project))).toBe(0);
    const organizationId = "org_lervoowner01";
    expect(
      await runCli(
        [
          "organization",
          "bind-team",
          "--organization",
          organizationId,
          "--team",
          "team_central0001",
          "--kind",
          "central",
          "--write",
        ],
        io(central),
      ),
    ).toBe(0);
    expect(
      await runCli(
        [
          "organization",
          "bind-team",
          "--organization",
          organizationId,
          "--team",
          "team_project0001",
          "--kind",
          "project",
          "--write",
        ],
        io(project),
      ),
    ).toBe(0);
    const hired: string[] = [];
    expect(
      await runCli(
        ["agent", "hire", "--role", "ceo", "--provider", "codex", "--write", "--json"],
        io(central, hired),
      ),
    ).toBe(0);
    const agentId = JSON.parse(hired.join("")).agentId as string;
    const portfolioOutput: string[] = [];
    expect(
      await runCli(
        [
          "organization",
          "portfolio",
          "--organization",
          organizationId,
          "--team-root",
          central,
          "--team-root",
          project,
          "--json",
        ],
        io(central, portfolioOutput),
      ),
    ).toBe(0);
    const report = JSON.parse(portfolioOutput.join(""));
    expect(report).toMatchObject({ status: "current", teams: [{ teamKind: "central" }, {}] });

    const policyPath = resolve(central, "ceo-policy.json");
    const requestPath = resolve(central, "ceo-request.json");
    const reportPath = resolve(central, "organization-report.json");
    const budgetPolicyHash = `sha256:${"b".repeat(64)}`;
    await Promise.all([
      writeFile(
        policyPath,
        JSON.stringify({
          schemaVersion: 1,
          policyId: "ceop_lervoowner01",
          organizationId,
          appointedAgentId: agentId,
          allowedActions: ["agent.hire"],
          approvalRequiredActions: [],
          allowedTeamIds: ["team_project0001"],
          maximumAutomationDepth: 2,
          budgetPolicyHash,
        }),
      ),
      writeFile(
        requestPath,
        JSON.stringify({
          schemaVersion: 1,
          requestId: "ceor_hireagent01",
          organizationId,
          requestedByAgentId: agentId,
          action: "agent.hire",
          teamId: "team_project0001",
          risk: "low",
          automationDepth: 1,
          budget: { status: "within", policyHash: budgetPolicyHash },
          approvalId: null,
        }),
      ),
      writeFile(reportPath, JSON.stringify(report)),
    ]);
    const decisionOutput: string[] = [];
    expect(
      await runCli(
        [
          "organization",
          "ceo-evaluate",
          "--policy",
          policyPath,
          "--request",
          requestPath,
          "--report",
          reportPath,
          "--json",
        ],
        io(central, decisionOutput),
      ),
    ).toBe(0);
    expect(JSON.parse(decisionOutput.join(""))).toMatchObject({
      status: "allowed",
      reason: "policy_allows",
    });
  });

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
      ]);
      expect(JSON.stringify(organizationEvents)).not.toContain("999999999999999999");
      expect(JSON.stringify(organizationEvents)).not.toContain("222222222222222222");
    } finally {
      await storage.close();
    }
  });
});
