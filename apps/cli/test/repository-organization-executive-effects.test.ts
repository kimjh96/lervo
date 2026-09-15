import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { OrganizationExecutiveEffect } from "@lervo/application-contract";
import { afterEach, describe, expect, it } from "vitest";

import { inspectAgentOrganization } from "../src/agent-organization-runtime-binding.js";
import { runCli } from "../src/main.js";
import { RepositoryOrganizationExecutiveEffectAdapter } from "../src/repository-organization-executive-effects.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function effect(repositoryRoot: string): OrganizationExecutiveEffect {
  return {
    schemaVersion: 1,
    effectId: "ceoe_createteam01",
    organizationId: "org_lervoowner01",
    teamId: "team_project0001",
    action: "team.create",
    adapterId: "repository_organization_v1",
    parameters: { repositoryRoot, teamKind: "project" },
    parametersHash: `sha256:${"0".repeat(64)}`,
  };
}

describe("repository organization executive effects", () => {
  it("binds an allowlisted initialized repository as an exact team", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-ceo-team-create-"));
    roots.push(root);
    await runCli(["init", "--root", root, "--name", "ceo-team-create"], {
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
    });
    const adapter = new RepositoryOrganizationExecutiveEffectAdapter({
      cwd: root,
      allowedRepositoryRoots: [root],
    });
    await expect(adapter.apply(effect(root))).resolves.toMatchObject({
      status: "completed",
      externalEffectId: "team_project0001",
    });
    await expect(inspectAgentOrganization(root)).resolves.toMatchObject({
      team: {
        organizationId: "org_lervoowner01",
        teamId: "team_project0001",
        teamKind: "project",
      },
    });
  });

  it("rejects repository roots outside the executive allowlist", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-ceo-team-reject-"));
    roots.push(root);
    const adapter = new RepositoryOrganizationExecutiveEffectAdapter({
      cwd: root,
      allowedRepositoryRoots: [],
    });
    await expect(adapter.apply(effect(root))).resolves.toEqual({
      status: "rejected",
      reasonCode: "repository_not_allowlisted",
    });
  });
});
