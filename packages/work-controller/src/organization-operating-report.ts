import type {
  OrganizationOperatingReport,
  OrganizationTeamOperatingInput,
  OrganizationTeamOperatingSnapshot,
} from "@lervo/application-contract";

import { digest } from "./hash.js";

function snapshot(input: OrganizationTeamOperatingInput): OrganizationTeamOperatingSnapshot {
  return { ...structuredClone(input), snapshotHash: digest(input) };
}

export function createOrganizationOperatingReport(input: {
  organizationId: string;
  teams: readonly OrganizationTeamOperatingInput[];
}): OrganizationOperatingReport {
  const teams = input.teams
    .map(snapshot)
    .sort((left, right) => left.teamId.localeCompare(right.teamId));
  const issues: OrganizationOperatingReport["issues"] = [];
  const seenTeams = new Set<string>();
  const seenProjects = new Set<string>();
  for (const team of teams) {
    if (team.organizationId !== input.organizationId) {
      issues.push({ code: "organization_mismatch", teamId: team.teamId });
    }
    if (seenTeams.has(team.teamId)) issues.push({ code: "duplicate_team", teamId: team.teamId });
    if (seenProjects.has(team.projectId)) {
      issues.push({ code: "duplicate_project", projectId: team.projectId });
    }
    seenTeams.add(team.teamId);
    seenProjects.add(team.projectId);
  }
  if (!teams.some((team) => team.teamKind === "central")) {
    issues.push({ code: "missing_central_team", teamId: null });
  }
  issues.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const status: OrganizationOperatingReport["status"] = issues.some(
    (issue) => issue.code !== "missing_central_team",
  )
    ? "conflict"
    : issues.length > 0
      ? "incomplete"
      : "current";
  const content = {
    schemaVersion: 1 as const,
    organizationId: input.organizationId,
    status,
    teams,
    issues,
  };
  return { ...content, reportHash: digest(content) };
}
