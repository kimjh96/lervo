import type { AgentSummary } from "@lervo/session-host-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { type ListRetry, showProjectAgents } from "../src/features/agents/model/listing";
import { listSettled, useAgentStore } from "../src/features/agents/model/store";
import { type ApplicationCommands, RequestFailure } from "../src/ports";

const agent = (displayName: string): AgentSummary => ({
  agentId: `agt_${displayName.toLowerCase().padEnd(24, "0").slice(0, 24)}`,
  displayName,
  roleId: "developer",
  roleName: "Developer",
  status: "active",
  origin: "team",
  revision: 1,
});

/**
 * A core whose `agents.list` fails for a project as many times as `failures` says, then answers
 * from `lists`, recording every project it was asked for.
 */
function core(lists: Record<string, AgentSummary[]>, failures: Record<string, number>) {
  const asked: string[] = [];
  const commands: ApplicationCommands = {
    async run(command, arguments_ = {}) {
      const projectId = String(arguments_.projectId);
      asked.push(projectId);
      if (command !== "agents.list") throw new RequestFailure("role_not_found");
      const left = failures[projectId] ?? 0;
      if (left > 0) {
        failures[projectId] = left - 1;
        throw new RequestFailure("application_failed", { coreCode: "workforce_busy" });
      }
      return { projectId, agents: lists[projectId] ?? [], roles: [] } as never;
    },
  };
  return { commands, asked };
}

/** A retry whose waits end when the test lets them, recording each wait. */
function heldRetry(delaysMs: readonly number[]) {
  const waits: number[] = [];
  let release: () => void = () => undefined;
  const retry: ListRetry = {
    delaysMs,
    wait: (ms) =>
      new Promise((resolve) => {
        waits.push(ms);
        release = resolve;
      }),
  };
  return { retry, waits, release: () => release() };
}

const immediate = (delaysMs: readonly number[]): ListRetry => ({
  delaysMs,
  wait: () => Promise.resolve(),
});

const names = () => useAgentStore.getState().agents.map((item) => item.displayName);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useAgentStore.setState({
    projectId: "prj_axli",
    asks: 0,
    agents: [agent("Elio"), agent("Ciel")],
    roles: [],
    loaded: true,
    failure: null,
    arrived: new Set(),
    models: [],
  });
});

describe("listing a project's agents", () => {
  it("never shows the previous project's agents under a project whose list failed", async () => {
    // On 2026-11-28 a project cloned a second earlier showed another project's five agents.
    const { commands } = core({ prj_argo: [agent("Nova")] }, { prj_argo: 1 });
    const held = heldRetry([1_000]);
    const listing = showProjectAgents(commands, "prj_argo", held.retry);
    await settle();
    // While it tries again, the asked project shows no agents and no failure yet.
    expect(useAgentStore.getState()).toMatchObject({
      projectId: "prj_argo",
      loaded: false,
      failure: null,
    });
    expect(names()).toEqual([]);
    expect(listSettled(useAgentStore.getState())).toBe(false);
    held.release();
    await listing;
    // The failure was for a moment: the next try shows the project's own agents.
    expect(held.waits).toEqual([1_000]);
    expect(names()).toEqual(["Nova"]);
    expect(useAgentStore.getState()).toMatchObject({ loaded: true, failure: null });
  });

  it("shows the failure after the last try and recovers when the project is asked again", async () => {
    const lists = { prj_argo: [agent("Nova")] };
    const failing = core(lists, { prj_argo: 3 });
    await showProjectAgents(failing.commands, "prj_argo", immediate([1, 2]));
    expect(failing.asked).toEqual(["prj_argo", "prj_argo", "prj_argo"]);
    expect(useAgentStore.getState()).toMatchObject({
      projectId: "prj_argo",
      loaded: false,
      failure: "application_failed",
    });
    expect(names()).toEqual([]);
    // The failure shows in the agents' place.
    expect(listSettled(useAgentStore.getState())).toBe(true);

    // Coming back to the project asks again, and the list replaces the failure.
    await showProjectAgents(core(lists, {}).commands, "prj_argo", immediate([1, 2]));
    expect(names()).toEqual(["Nova"]);
    expect(useAgentStore.getState()).toMatchObject({ loaded: true, failure: null });
  });

  it("stops trying once the person asked for another project", async () => {
    const { commands, asked } = core(
      { prj_argo: [agent("Nova")], prj_axli: [agent("Elio")] },
      { prj_argo: 5 },
    );
    const held = heldRetry([1_000, 2_000]);
    const argo = showProjectAgents(commands, "prj_argo", held.retry);
    await settle();
    await showProjectAgents(commands, "prj_axli", immediate([]));
    held.release();
    await argo;
    expect(asked).toEqual(["prj_argo", "prj_axli"]);
    expect(names()).toEqual(["Elio"]);
    expect(useAgentStore.getState()).toMatchObject({ projectId: "prj_axli", failure: null });
  });

  it("keeps the shown project's agents when a later list of it fails", async () => {
    const { commands } = core({}, { prj_axli: 2 });
    await showProjectAgents(commands, "prj_axli", immediate([1]));
    expect(names()).toEqual(["Elio", "Ciel"]);
    expect(useAgentStore.getState()).toMatchObject({
      projectId: "prj_axli",
      loaded: true,
      failure: "application_failed",
    });
  });
});
