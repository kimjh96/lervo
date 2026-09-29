import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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
});
