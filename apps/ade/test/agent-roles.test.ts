import type { AgentSummary, HireableRole } from "@lervo/session-host-contract";
import { beforeEach, describe, expect, it } from "vitest";

import {
  changeFailureCode,
  closeAgentSheet,
  hireWithRole,
  moveAgentRole,
  openHireSheet,
  ownRole,
  removeRole,
} from "../src/features/agents/model/roles";
import { useAgentStore } from "../src/features/agents/model/store";
import { type ApplicationCommands, RequestFailure } from "../src/ports";

const lumi: AgentSummary = {
  agentId: `agt_${"a".repeat(24)}`,
  displayName: "Lumi",
  roleId: "designer",
  roleName: "Designer",
  status: "active",
  origin: "team",
  revision: 1,
};

const drawing: HireableRole = {
  roleId: "drawing-review",
  name: "Drawing Review",
  description: "Reads drawings.",
  source: "repository",
};

/** A core that records each command and refuses those in `refused` with the core's code. */
function core(refused: Record<string, string> = {}) {
  const ran: string[] = [];
  const commands: ApplicationCommands = {
    async run(command, arguments_) {
      ran.push(`${command}:${JSON.stringify(arguments_ ?? {})}`);
      if (command === "agents.list")
        return { projectId: "prj_a", agents: [lumi], roles: [drawing] } as never;
      const code = refused[command];
      if (code !== undefined) throw new RequestFailure("application_failed", { coreCode: code });
      if (command === "role.add") return { projectId: "prj_a", role: drawing } as never;
      return {} as never;
    },
  };
  return { commands, ran };
}

beforeEach(() => {
  useAgentStore.setState({
    projectId: "prj_a",
    requested: "prj_a",
    agents: [lumi],
    roles: [drawing],
    loaded: true,
    sheet: null,
  });
});

describe("hiring and the project's roles", () => {
  it("adds a new role before hiring with a nickname, then lists the agents again", async () => {
    const { commands, ran } = core();
    const added: string[] = [];
    await hireWithRole(
      commands,
      "prj_a",
      { name: " Bora ", role: { name: "Drawing Review", description: "Reads.", from: "designer" } },
      (roleId) => added.push(roleId),
    );
    expect(ran).toEqual([
      'role.add:{"projectId":"prj_a","name":"Drawing Review","description":"Reads.","from":"designer"}',
      'agent.hire:{"projectId":"prj_a","role":"drawing-review","name":"Bora"}',
      'agents.list:{"projectId":"prj_a"}',
    ]);
    expect(added).toEqual(["drawing-review"]);
  });

  it("lets the core name an agent hired without a name, and lists again after a refusal", async () => {
    const { commands, ran } = core({ "agent.hire": "agent_not_authorized" });
    const hiring = hireWithRole(commands, "prj_a", { name: "", role: "designer" });
    await expect(hiring).rejects.toBeInstanceOf(RequestFailure);
    expect(ran[0]).toBe('agent.hire:{"projectId":"prj_a","role":"designer"}');
    expect(ran.at(-1)).toBe('agents.list:{"projectId":"prj_a"}');
    expect(changeFailureCode(await hiring.catch((error: unknown) => error))).toBe(
      "agent_not_authorized",
    );
  });

  it("shows an agent's new role at once and keeps the core's refusal of a held role", async () => {
    const { commands } = core({ "role.remove": "role_in_use" });
    const moving = moveAgentRole(commands, "prj_a", lumi, drawing);
    expect(useAgentStore.getState().agents[0]).toMatchObject({
      roleId: "drawing-review",
      roleName: "Drawing Review",
    });
    await moving;
    const removing = removeRole(commands, "prj_a", "drawing-review");
    expect(changeFailureCode(await removing.catch((error: unknown) => error))).toBe("role_in_use");
    expect(changeFailureCode(new Error("offline"))).toBe("session_host_unavailable");
  });

  it("opens and closes the hire sheet, and edits only the project's own roles", () => {
    openHireSheet(null);
    expect(useAgentStore.getState().sheet).toEqual({ kind: "hire", roleId: null });
    closeAgentSheet();
    expect(useAgentStore.getState().sheet).toBeNull();
    expect(ownRole(drawing)).toBe(true);
    expect(ownRole({ ...drawing, source: "built_in" })).toBe(false);
    expect(ownRole(undefined)).toBe(false);
  });
});
