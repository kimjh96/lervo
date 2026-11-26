import type { AgentSummary, ApplicationResults } from "@lervo/session-host-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { hireAgent, showProjectAgents } from "../src/features/agents/model/controller";
import {
  agentActivity,
  defaultParticipants,
  firstSentence,
  toggleParticipant,
  managesAgents,
  productOwnerRole,
  teamAgents,
} from "../src/features/agents/model/decisions";
import { useAgentStore } from "../src/features/agents/model/store";
import { type ApplicationCommands, RequestFailure } from "../src/ports";

const agent = (displayName: string, origin: "team" | "lervo"): AgentSummary => ({
  agentId: `agt_${displayName.toLowerCase().padEnd(24, "0").slice(0, 24)}`,
  displayName,
  roleId: "developer",
  roleName: "Developer",
  status: "active",
  origin,
  revision: 1,
});

const roles: ApplicationResults["agents.list"]["roles"] = [
  {
    roleId: "developer",
    name: "Developer",
    description: "Builds and fixes. Within its paths.",
    source: "built_in",
  },
  {
    roleId: "product-owner",
    name: "Product Owner",
    description: "Owns the product.",
    source: "repository",
  },
];

/** A core whose `agents.list` answers per project from `lists`, recording every command it ran. */
function core(lists: Record<string, AgentSummary[]>, hired?: AgentSummary) {
  const ran: string[] = [];
  const commands: ApplicationCommands = {
    async run(command, arguments_ = {}) {
      ran.push(`${command}:${String(arguments_.projectId)}`);
      if (command === "agents.list")
        return {
          projectId: arguments_.projectId,
          agents: lists[String(arguments_.projectId)] ?? [],
          roles,
        } as never;
      if (command === "agent.hire" && hired !== undefined) {
        lists[String(arguments_.projectId)] = [
          ...(lists[String(arguments_.projectId)] ?? []),
          hired,
        ];
        return { projectId: arguments_.projectId, agent: hired } as never;
      }
      throw new RequestFailure("role_not_found");
    },
  };
  return { commands, ran };
}

beforeEach(() => {
  useAgentStore.setState({
    projectId: null,
    requested: null,
    agents: [],
    roles: [],
    loaded: false,
    failure: null,
  });
});

describe("the sidebar's agents", () => {
  it("keeps the team apart from Lervo's agents and reads roles as one line", () => {
    const agents = [agent("Elio", "team"), agent("Steward", "lervo"), agent("Ciel", "team")];
    expect(teamAgents(agents).map((item) => item.displayName)).toEqual(["Elio", "Ciel"]);
    expect(productOwnerRole(roles)?.name).toBe("Product Owner");
    expect(firstSentence("Builds and fixes. Within its paths.")).toBe("Builds and fixes.");
    expect(firstSentence("No period here")).toBe("No period here");
    expect(managesAgents(["agents.list"])).toBe(true);
    expect(managesAgents(["project.rename"])).toBe(false);
    expect(managesAgents(null)).toBe(false);
  });

  it("shows the selected project's agents and drops a list that arrives after a switch", async () => {
    const { commands } = core({ prj_a: [agent("Elio", "team")], prj_b: [agent("Ciel", "team")] });
    // The person switches to prj_b before prj_a's list arrives.
    await Promise.all([showProjectAgents(commands, "prj_a"), showProjectAgents(commands, "prj_b")]);
    expect(useAgentStore.getState()).toMatchObject({ projectId: "prj_b", loaded: true });
    expect(useAgentStore.getState().agents.map((item) => item.displayName)).toEqual(["Ciel"]);
    // Another project's first list has no arrivals.
    expect(useAgentStore.getState().arrived.size).toBe(0);
  });

  it("hires by role and lists again, and records a refused hire's code", async () => {
    const { commands, ran } = core({ prj_a: [] }, agent("Elio", "team"));
    await showProjectAgents(commands, "prj_a");
    await hireAgent(commands, "prj_a", "product-owner");
    expect(ran).toEqual(["agents.list:prj_a", "agent.hire:prj_a", "agents.list:prj_a"]);
    expect(useAgentStore.getState().agents.map((item) => item.displayName)).toEqual(["Elio"]);
    // The hired agent arrives; an agent of the first list never does.
    expect([...useAgentStore.getState().arrived]).toEqual([agent("Elio", "team").agentId]);

    const refusing = core({ prj_a: [] });
    await hireAgent(refusing.commands, "prj_a", "astronaut");
    expect(useAgentStore.getState().failure).toBe("role_not_found");
  });

  it("chooses default participants, toggles them, and reads each agent's activity", () => {
    const elio = { ...agent("Elio", "team"), roleId: "product-owner" };
    const ciel = agent("Ciel", "team");
    expect(defaultParticipants([ciel, elio])).toEqual([elio.agentId]);
    // A team without a Product Owner is offered one that Lervo hires (ADR-0646).
    expect(defaultParticipants([ciel])).toEqual(["hire:product-owner"]);
    expect(defaultParticipants([])).toEqual(["hire:product-owner"]);
    expect(toggleParticipant([elio.agentId], ciel.agentId)).toEqual([elio.agentId, ciel.agentId]);
    expect(toggleParticipant([elio.agentId, ciel.agentId], elio.agentId)).toEqual([ciel.agentId]);
    // The last participant stays.
    expect(toggleParticipant([ciel.agentId], ciel.agentId)).toEqual([ciel.agentId]);
    const workspace = (sessionId: string, agentId: string) =>
      ({ workspaceId: `wsp_${sessionId}`, sessionId, agentId }) as unknown as Parameters<
        typeof agentActivity
      >[1][number];
    const workspaces = [workspace("s1", ciel.agentId), workspace("s2", ciel.agentId)];
    expect(agentActivity(ciel.agentId, workspaces, { s1: "working", s2: "idle" })).toBe("working");
    expect(agentActivity(ciel.agentId, workspaces, { s1: "working", s2: "needs_user" })).toBe(
      "needsYou",
    );
    expect(agentActivity(elio.agentId, workspaces, { s1: "working" })).toBeNull();
  });
});

describe("mentions in a conversation's text", () => {
  it("sets apart exactly the team agents the core would deliver to", async () => {
    const { mentionParts } = await import("../src/features/agents/model/mentions");
    const team = [
      { agentId: "agt_arin", displayName: "Arin" },
      { agentId: "agt_writer", displayName: "Arin-92AE" },
    ];
    expect(mentionParts("@arin, ask @Arin-92AE and mail ops@Arin.dev", team)).toEqual([
      { agentId: "agt_arin", name: "@arin" },
      ", ask ",
      { agentId: "agt_writer", name: "@Arin-92AE" },
      " and mail ops@Arin.dev",
    ]);
    expect(mentionParts("no mention here", team)).toEqual(["no mention here"]);
  });
});
