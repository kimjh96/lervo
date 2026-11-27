import type { AgentSummary } from "@lervo/session-host-contract";
import { beforeEach, describe, expect, it } from "vitest";

import {
  renameAgent,
  setAgentModel,
  setAgentStatus,
} from "../src/features/agents/model/controller";
import { useAgentStore } from "../src/features/agents/model/store";
import { type ApplicationCommands, RequestFailure } from "../src/ports";

const ciel: AgentSummary = {
  agentId: `agt_${"c".repeat(24)}`,
  displayName: "Ciel",
  roleId: "developer",
  roleName: "Developer",
  status: "active",
  origin: "team",
  revision: 1,
  model: { tier: "strong", effort: "medium", source: "role" },
};

/**
 * A core that answers a change only when `answer` is called, so a test can look at the agents in
 * between, and lists `listed` afterwards.
 */
function slowCore(listed: () => AgentSummary[], refuse = false) {
  let answer: () => void = () => undefined;
  const commands: ApplicationCommands = {
    async run(command) {
      if (command === "agents.list")
        return { projectId: "prj_a", agents: listed(), roles: [] } as never;
      await new Promise<void>((resolve) => (answer = resolve));
      if (refuse) throw new RequestFailure("application_failed", { coreCode: "agent_conflict" });
      return {} as never;
    },
  };
  return { commands, answer: () => answer() };
}

const shownName = () => useAgentStore.getState().agents[0]?.displayName;

beforeEach(() => {
  useAgentStore.setState({ projectId: "prj_a", requested: "prj_a", agents: [ciel], loaded: true });
});

describe("a change to an agent", () => {
  it("shows the new name at once, never the old one again while the core answers", async () => {
    const core = slowCore(() => [{ ...ciel, displayName: "Nova", revision: 2 }]);
    const renaming = renameAgent(core.commands, "prj_a", ciel, "Nova");
    expect(shownName()).toBe("Nova");
    await Promise.resolve();
    expect(shownName()).toBe("Nova");
    core.answer();
    await renaming;
    expect(useAgentStore.getState().agents[0]).toMatchObject({ displayName: "Nova", revision: 2 });
  });

  it("shows the agent as it was when the core refuses, and rejects", async () => {
    const core = slowCore(() => [ciel], true);
    const renaming = renameAgent(core.commands, "prj_a", ciel, "Nova");
    expect(shownName()).toBe("Nova");
    core.answer();
    await expect(renaming).rejects.toMatchObject({ code: "application_failed" });
    expect(shownName()).toBe("Ciel");
  });

  it("shows a new model, effort, or status at once", () => {
    const core = slowCore(() => [ciel]);
    void setAgentModel(core.commands, "prj_a", ciel, { tier: "frontier", effort: "high" });
    expect(useAgentStore.getState().agents[0]?.model).toMatchObject({
      tier: "frontier",
      effort: "high",
    });
    void setAgentStatus(core.commands, "prj_a", ciel, "suspended");
    expect(useAgentStore.getState().agents[0]?.status).toBe("suspended");
  });
});
