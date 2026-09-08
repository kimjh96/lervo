import { describe, expect, it } from "vitest";

import { createOrganizationOperatingReport } from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function team(teamId: string, projectId: string, teamKind: "central" | "project") {
  return {
    organizationId: "org_lervo0001",
    teamId,
    teamKind,
    projectId,
    repositoryIdentityHash: hash("a"),
    membershipCounts: { active: 1, suspended: 0, ended: 0 },
    deploymentCounts: { active: 1, retired: 0 },
    activeChannelMembershipCount: 1,
    activeDeliberationCount: 0,
    activeAgentContextEntryCount: 2,
    currentWorkstream: null,
    sourceHeadSequence: 10,
  };
}

describe("organization operating report", () => {
  it("builds one deterministic multi-team projection without merging team authority", () => {
    const report = createOrganizationOperatingReport({
      organizationId: "org_lervo0001",
      teams: [
        team("team_project0001", "prj_project0001", "project"),
        team("team_central0001", "prj_central0001", "central"),
      ],
    });

    expect(report.status).toBe("current");
    expect(report.teams.map((item) => item.teamId)).toEqual([
      "team_central0001",
      "team_project0001",
    ]);
    expect(report.teams[0]!.snapshotHash).toMatch(/^sha256:/u);
    expect(report.reportHash).toMatch(/^sha256:/u);
  });

  it("fails the projection closed on duplicate project ownership", () => {
    const report = createOrganizationOperatingReport({
      organizationId: "org_lervo0001",
      teams: [
        team("team_central0001", "prj_shared0001", "central"),
        team("team_project0001", "prj_shared0001", "project"),
      ],
    });
    expect(report.status).toBe("conflict");
    expect(report.issues).toContainEqual({
      code: "duplicate_project",
      projectId: "prj_shared0001",
    });
  });
});
