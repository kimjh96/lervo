import type { AgentSummary } from "@lervo/session-host-contract";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type AgentMarkDependencies,
  bindAgentMarks,
  chooseAgentMark,
  clearAgentMark,
} from "../src/features/agents/model/marks";
import { useAgentStore } from "../src/features/agents/model/store";
import { useProjectStore } from "../src/features/projects/model/store";
import type { ApplicationCommands } from "../src/ports";

const sha = "a".repeat(64);
const ciel: AgentSummary = {
  agentId: `agt_${"c".repeat(24)}`,
  displayName: "Ciel",
  roleId: "developer",
  roleName: "Developer",
  status: "active",
  origin: "team",
  revision: 1,
  mark: null,
};
const marked = { ...ciel, revision: 2, mark: { sha256: sha, mediaType: "image/png" as const } };

function dependencies(answers: Record<string, unknown>) {
  const ran: string[] = [];
  const kept: string[] = [];
  const commands: ApplicationCommands = {
    async run(command) {
      ran.push(command);
      return answers[command] as never;
    },
  };
  const value: AgentMarkDependencies = {
    commands,
    images: {
      prepare: () => Promise.reject(new Error("unused")),
      prepareMark: () => Promise.resolve(btoa("png")),
      thumbnail: () => Promise.resolve("data:image/png;base64,dGh1bWI="),
    },
    memory: {
      selected: () => null,
      select: () => undefined,
      marks: () => ({}),
      keepMark: (key) => void kept.push(key),
    },
    files: { readImage: () => Promise.resolve(new Blob(["png"])) } as never,
    choosers: { image: () => Promise.resolve("/images/ciel.png") } as never,
  };
  return { value, ran, kept };
}

beforeEach(() => {
  useAgentStore.setState({ projectId: "prj_1", agents: [ciel] });
  useProjectStore.setState({ marks: {} });
});

describe("an agent's image", () => {
  it("sets the chosen image, keeps its thumbnail at once, and lists the agents again", async () => {
    const { value, ran, kept } = dependencies({
      "agent.mark.set": { projectId: "prj_1", agent: marked },
      "agents.list": { projectId: "prj_1", agents: [marked], roles: [] },
    });
    await chooseAgentMark(value, "prj_1", ciel, "Choose an image for Ciel");
    expect(ran).toEqual(["agent.mark.set", "agents.list"]);
    expect(kept).toEqual([sha]);
    expect(useProjectStore.getState().marks[sha]).toBe("data:image/png;base64,dGh1bWI=");
  });

  it("reads each listed image it has not kept, and clears an image", async () => {
    const { value, ran } = dependencies({
      "agent.mark.read": {
        projectId: "prj_1",
        agentId: ciel.agentId,
        image: { sha256: sha, mediaType: "image/png", data: btoa("png") },
      },
      "agent.mark.clear": { projectId: "prj_1", agent: ciel },
      "agents.list": { projectId: "prj_1", agents: [ciel], roles: [] },
    });
    const unbind = bindAgentMarks(
      value,
      (key) => useProjectStore.getState().marks[key] !== undefined,
    );
    useAgentStore.setState({ agents: [marked] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ran).toEqual(["agent.mark.read"]);
    expect(useProjectStore.getState().marks[sha]).toBeDefined();
    // A kept image is never read again.
    useAgentStore.setState({ agents: [{ ...marked }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ran).toEqual(["agent.mark.read"]);
    unbind();
    await clearAgentMark(value.commands, "prj_1", marked);
    expect(ran).toEqual(["agent.mark.read", "agent.mark.clear", "agents.list"]);
  });
});
