import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { listAgents, registerAgent } from "@lervo/agent-workforce";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pendingAgentOrigins, recordPendingAgentOrigins } from "../src/agent-origin-stage.js";
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

/** A PNG header of `side` pixels square, which is all the mark check reads. */
function pngBase64(side: number): string {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, side);
  new DataView(bytes.buffer).setUint32(20, side);
  return Buffer.from(bytes).toString("base64");
}

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

  it("lists a team agent's model by its role and changes it as the owner chooses", async () => {
    const { projectId } = await project();
    const hired = (await runCoreLinkAgentCommand("agent.hire", {
      projectId,
      role: "product-owner",
    })) as { agent: { agentId: string; revision: number; model: unknown } };
    expect(hired.agent.model).toEqual({
      tier: "strong",
      effort: "high",
      source: "role",
      displayName: "Opus",
    });
    const changed = (await runCoreLinkAgentCommand("agent.model", {
      projectId,
      agentId: hired.agent.agentId,
      revision: hired.agent.revision,
      tier: "frontier",
      effort: "xhigh",
    })) as { agent: { model: unknown } };
    expect(changed.agent.model).toEqual({
      tier: "frontier",
      effort: "xhigh",
      source: "owner",
      displayName: "Fable",
    });
    await expect(
      runCoreLinkAgentCommand("agent.model", {
        projectId,
        agentId: hired.agent.agentId,
        revision: 2,
        tier: "huge",
        effort: "high",
      }),
    ).rejects.toMatchObject({ code: "agent_argument_invalid" });
  });

  it("offers the provider's models, most capable first, and renames an agent in place", async () => {
    const { projectId } = await project();
    const hired = (await runCoreLinkAgentCommand("agent.hire", {
      projectId,
      role: "developer",
      name: "Arin",
    })) as { agent: { agentId: string; revision: number } };
    const listed = (await runCoreLinkAgentCommand("agents.list", { projectId })) as {
      models: { tier: string; displayName: string }[];
    };
    expect(listed.models.map((model) => model.displayName)).toEqual([
      "Fable",
      "Opus",
      "Sonnet",
      "Haiku",
    ]);
    const renamed = (await runCoreLinkAgentCommand("agent.rename", {
      projectId,
      agentId: hired.agent.agentId,
      revision: hired.agent.revision,
      name: "Arin Park",
    })) as { agent: { displayName: string; revision: number } };
    expect(renamed.agent).toMatchObject({ displayName: "Arin Park", revision: 2 });
    await expect(
      runCoreLinkAgentCommand("agent.rename", {
        projectId,
        agentId: hired.agent.agentId,
        revision: 1,
        name: "Arin Lee",
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
  });

  it("pauses and resumes an agent, and leaves retiring to the terminal", async () => {
    const { projectId } = await project();
    const hired = (await runCoreLinkAgentCommand("agent.hire", {
      projectId,
      role: "writer",
      name: "Nia",
    })) as { agent: { agentId: string; revision: number } };
    const paused = (await runCoreLinkAgentCommand("agent.status", {
      projectId,
      agentId: hired.agent.agentId,
      revision: hired.agent.revision,
      status: "suspended",
    })) as { agent: { status: string; revision: number } };
    expect(paused.agent.status).toBe("suspended");
    const resumed = (await runCoreLinkAgentCommand("agent.status", {
      projectId,
      agentId: hired.agent.agentId,
      revision: paused.agent.revision,
      status: "active",
    })) as { agent: { status: string } };
    expect(resumed.agent.status).toBe("active");
    await expect(
      runCoreLinkAgentCommand("agent.status", {
        projectId,
        agentId: hired.agent.agentId,
        revision: 3,
        status: "retired",
      }),
    ).rejects.toMatchObject({ code: "agent_argument_invalid" });
  });

  it("sets, reads, and clears an agent's image, and keeps another agent's when they share it", async () => {
    const { projectId, root } = await project();
    type Changed = { agent: { agentId: string; revision: number; mark: unknown } };
    const hire = async (name: string) =>
      (
        (await runCoreLinkAgentCommand("agent.hire", {
          projectId,
          role: "developer",
          name,
        })) as Changed
      ).agent;
    const ciel = await hire("Ciel");
    const arin = await hire("Arin");
    const image = pngBase64(64);
    const marked = (await runCoreLinkAgentCommand("agent.mark.set", {
      projectId,
      agentId: ciel.agentId,
      revision: ciel.revision,
      data: image,
    })) as Changed;
    const mark = marked.agent.mark as { sha256: string; mediaType: string };
    expect(mark).toMatchObject({ mediaType: "image/png" });
    await expect(
      stat(join(root, ".lervo/assets/agents", `${mark.sha256}.png`)),
    ).resolves.toBeTruthy();
    expect(
      await runCoreLinkAgentCommand("agent.mark.read", { projectId, agentId: ciel.agentId }),
    ).toEqual({ projectId, agentId: ciel.agentId, image: { ...mark, data: image } });
    // Arin shows the same image; clearing Ciel's keeps the file Arin still shows.
    await runCoreLinkAgentCommand("agent.mark.set", {
      projectId,
      agentId: arin.agentId,
      revision: arin.revision,
      data: image,
    });
    const cleared = (await runCoreLinkAgentCommand("agent.mark.clear", {
      projectId,
      agentId: ciel.agentId,
      revision: marked.agent.revision,
    })) as Changed;
    expect(cleared.agent.mark).toBeNull();
    await expect(
      stat(join(root, ".lervo/assets/agents", `${mark.sha256}.png`)),
    ).resolves.toBeTruthy();
    expect(
      await runCoreLinkAgentCommand("agent.mark.read", { projectId, agentId: ciel.agentId }),
    ).toEqual({ projectId, agentId: ciel.agentId, image: null });
    // A file that is no image is refused, and a stale revision conflicts.
    await expect(
      runCoreLinkAgentCommand("agent.mark.set", {
        projectId,
        agentId: ciel.agentId,
        revision: cleared.agent.revision,
        data: Buffer.from("not an image").toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "agent_mark_invalid" });
    await expect(
      runCoreLinkAgentCommand("agent.mark.clear", {
        projectId,
        agentId: ciel.agentId,
        revision: ciel.revision,
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
  });

  it("records each agent's origin once through the upgrade stage, then lists the recorded one", async () => {
    const { projectId, root } = await project();
    const steward = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "claude",
      displayName: "Knowledge Steward",
    });
    const worker = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "claude",
      parentAgentId: steward.agentId,
    });
    const hired = (await runCoreLinkAgentCommand("agent.hire", {
      projectId,
      role: "developer",
    })) as {
      agent: { agentId: string };
    };
    const pending = await pendingAgentOrigins(root);
    // A hire over the core link already records its origin; the steward and its worker do not.
    expect(pending.get(steward.agentId)).toBe("lervo");
    expect(pending.get(worker.agentId)).toBe("lervo");
    expect(pending.has(hired.agent.agentId)).toBe(false);
    expect(await recordPendingAgentOrigins(root)).toBe(pending.size);
    expect(await recordPendingAgentOrigins(root)).toBe(0);
    const origins = new Map((await listAgents(root)).map((agent) => [agent.agentId, agent.origin]));
    expect(origins.get(steward.agentId)).toBe("lervo");
    expect(origins.get(hired.agent.agentId)).toBe("team");
  });

  it("adds, edits, and removes the project's roles, and moves an agent between them", async () => {
    const { projectId } = await project();
    const added = (await runCoreLinkAgentCommand("role.add", {
      projectId,
      name: "Drawing Review",
      description: "Reads drawings and owns their interpretation.",
      from: "designer",
    })) as { role: { roleId: string; name: string; source: string } };
    expect(added.role).toEqual({
      roleId: "drawing-review",
      name: "Drawing Review",
      description: "Reads drawings and owns their interpretation.",
      source: "repository",
    });
    const hired = (await runCoreLinkAgentCommand("agent.hire", {
      projectId,
      role: "drawing-review",
      name: "Lumi",
    })) as { agent: { agentId: string; revision: number; roleName: string } };
    expect(hired.agent.roleName).toBe("Drawing Review");
    const edited = (await runCoreLinkAgentCommand("role.edit", {
      projectId,
      role: "drawing-review",
      name: "Drawing Understanding",
    })) as { role: { name: string }; changed: boolean };
    expect(edited).toMatchObject({ changed: true, role: { name: "Drawing Understanding" } });
    const listed = (await runCoreLinkAgentCommand("agents.list", { projectId })) as Listed;
    expect(listed.agents.find((agent) => agent.displayName === "Lumi")?.roleName).toBe(
      "Drawing Understanding",
    );
    await expect(
      runCoreLinkAgentCommand("role.remove", { projectId, role: "drawing-review" }),
    ).rejects.toMatchObject({ code: "role_in_use" });
    await expect(
      runCoreLinkAgentCommand("role.edit", { projectId, role: "developer", name: "Dev" }),
    ).rejects.toMatchObject({ code: "role_built_in" });
    const moved = (await runCoreLinkAgentCommand("agent.role", {
      projectId,
      agentId: hired.agent.agentId,
      revision: hired.agent.revision + 1,
      role: "designer",
    })) as { agent: { roleId: string; status: string } };
    expect(moved.agent).toMatchObject({ roleId: "designer", status: "active" });
    expect(
      await runCoreLinkAgentCommand("role.remove", { projectId, role: "drawing-review" }),
    ).toEqual({ projectId, roleId: "drawing-review" });
    await expect(
      runCoreLinkAgentCommand("role.add", { projectId, name: "No Template", description: "x" }),
    ).rejects.toMatchObject({ code: "role_argument_missing" });
  });
});
