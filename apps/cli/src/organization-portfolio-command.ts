import { resolve } from "node:path";

import { projectAgentContext, projectAgentOrganization } from "@lervo/agent-organization";
import { listAgents } from "@lervo/agent-workforce";
import type { OrganizationTeamOperatingInput } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge/workstream";
import type { EventEnvelope } from "@lervo/schemas";
import { createOrganizationOperatingReport } from "@lervo/work-controller";

import type { CliIo } from "./types.js";

function readEvents(storage: Awaited<ReturnType<typeof openProjectStorage>>): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const page = storage.events.list({ afterSeq, limit: 1_000 });
    events.push(...page);
    if (page.length < 1_000) return events;
    afterSeq = page.at(-1)!.seq;
  }
}

async function inspectTeam(root: string): Promise<OrganizationTeamOperatingInput> {
  const storage = await openProjectStorage(root);
  try {
    const events = readEvents(storage);
    const organization = projectAgentOrganization({
      projectId: storage.manifest.projectId,
      events: events.filter((event) => event.type.startsWith("organization.")),
    });
    if (organization.team === null) {
      throw new Error(`No organization team is bound at ${root}.`);
    }
    const agents = await listAgents(root);
    const contexts = agents.map((agent) =>
      projectAgentContext({
        projectId: storage.manifest.projectId,
        agentId: agent.agentId,
        agents,
        events,
      }),
    );
    const workstream = await readCurrentWorkstreamState(root);
    const count = <T extends { status: string }>(items: readonly T[], status: string) =>
      items.filter((item) => item.status === status).length;
    return {
      organizationId: organization.team.organizationId,
      teamId: organization.team.teamId,
      teamKind: organization.team.teamKind,
      projectId: organization.team.projectId,
      repositoryIdentityHash: organization.team.repositoryIdentityHash,
      membershipCounts: {
        active: count(organization.memberships, "active"),
        suspended: count(organization.memberships, "suspended"),
        ended: count(organization.memberships, "ended"),
      },
      deploymentCounts: {
        active: organization.deployments.filter((item) => item.retiredAt === null).length,
        retired: organization.deployments.filter((item) => item.retiredAt !== null).length,
      },
      activeChannelMembershipCount: count(organization.channelMemberships, "active"),
      activeDeliberationCount: organization.deliberationParticipants.filter(
        (item) => item.releasedAt === null,
      ).length,
      activeAgentContextEntryCount: contexts.reduce(
        (total, context) =>
          total + context.entries.filter((entry) => entry.status === "active").length,
        0,
      ),
      currentWorkstream:
        workstream === null
          ? null
          : {
              workstreamId: workstream.snapshot.workstreamId,
              revision: workstream.snapshot.revision,
              status: workstream.snapshot.status,
            },
      sourceHeadSequence: events.at(-1)?.seq ?? 0,
    };
  } finally {
    await storage.close();
  }
}

export async function inspectOrganizationPortfolio(input: {
  cwd: string;
  organizationId: string;
  teamRoots: readonly string[];
}) {
  if (input.teamRoots.length === 0) throw new Error("Portfolio inspection requires team roots.");
  const roots = [...new Set(input.teamRoots.map((root) => resolve(input.cwd, root)))];
  const teams = await Promise.all(roots.map(inspectTeam));
  return createOrganizationOperatingReport({ organizationId: input.organizationId, teams });
}

export async function runOrganizationPortfolioCommand(input: {
  io: CliIo;
  organizationId: string;
  teamRoots: readonly string[];
  json: boolean | undefined;
}): Promise<number> {
  const report = await inspectOrganizationPortfolio({
    cwd: input.io.cwd,
    organizationId: input.organizationId,
    teamRoots: input.teamRoots,
  });
  input.io.stdout(
    input.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${report.organizationId} · ${report.teams.length} teams · ${report.status}\n`,
  );
  return 0;
}
