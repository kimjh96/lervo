import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { registerAgent } from "@lervo/agent-workforce";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCoreLinkAgentCommand } from "../src/core-link-agent-commands.js";
import { runCoreLinkProjectCommand } from "../src/core-link-project-commands.js";

const roots: string[] = [];
const previous = process.env.LERVO_USER_STATE_DIRECTORY;

beforeEach(async () => {
  const state = await mkdtemp(resolve(tmpdir(), "lervo-core-link-agents-state-"));
  roots.push(state);
  // The registry lives here, never in the host's own state.
  process.env.LERVO_USER_STATE_DIRECTORY = state;
});

afterEach(async () => {
  if (previous === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = previous;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Listed {
  agents: { displayName: string; roleId: string; roleName: string; origin: string }[];
  roles: { roleId: string; name: string; source: string }[];
}

async function project(): Promise<{ projectId: string; root: string }> {
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-core-link-agents-"));
  roots.push(parent);
  await runCoreLinkProjectCommand("projects.location", { path: join(parent, "projects") });
  return (await runCoreLinkProjectCommand("project.add", { source: "new", name: "Payments" })) as {
    projectId: string;
    root: string;
  };
}

describe("the core link's agent commands", () => {
  it("lists the team apart from Lervo's agents, with the roles a project can hire", async () => {
    const { projectId, root } = await project();
    for (const displayName of ["Ciel", "Knowledge Steward"])
      await registerAgent({
        repositoryRoot: root,
        roleId: "developer",
        provider: "claude",
        displayName,
      });
    const listed = (await runCoreLinkAgentCommand("agents.list", { projectId })) as Listed;
    expect(listed.agents.find((agent) => agent.displayName === "Ciel")).toMatchObject({
      roleName: "Developer",
      origin: "team",
    });
    expect(listed.agents.find((agent) => agent.displayName === "Knowledge Steward")?.origin).toBe(
      "lervo",
    );
    // The product owner can be hired before the project has its role.
    expect(listed.roles.find((role) => role.roleId === "product-owner")).toMatchObject({
      name: "Product Owner",
      source: "repository",
    });
    expect(listed.roles.find((role) => role.roleId === "developer")?.source).toBe("built_in");
  });

  it("hires a product owner, writing its role first, and refuses an unknown role", async () => {
    const { projectId } = await project();
    const hired = (await runCoreLinkAgentCommand("agent.hire", {
      projectId,
      role: "product-owner",
      name: "Elio",
    })) as { agent: { displayName: string; roleName: string; origin: string; provider: string } };
    expect(hired.agent).toMatchObject({
      displayName: "Elio",
      roleName: "Product Owner",
      origin: "team",
      provider: "claude",
    });
    const listed = (await runCoreLinkAgentCommand("agents.list", { projectId })) as Listed;
    expect(listed.agents.map((agent) => agent.displayName)).toContain("Elio");
    await expect(
      runCoreLinkAgentCommand("agent.hire", { projectId, role: "astronaut" }),
    ).rejects.toMatchObject({ code: "role_not_found" });
    await expect(
      runCoreLinkAgentCommand("agent.hire", { projectId, role: "developer", name: "elio" }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
  });
});
