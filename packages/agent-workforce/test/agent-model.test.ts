import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  agentModel,
  changeAgentModel,
  listAgents,
  registerAgent,
  roleModel,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-model-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_agent_model",
      now: new Date("2026-11-27T00:00:00.000Z"),
    }),
  );
  return root;
}

describe("an agent's model and effort (ADR-0647)", () => {
  it("chooses a team agent's model by its role and leaves Lervo's own to its routes", async () => {
    const root = await project();
    const developer = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const writer = await registerAgent({ repositoryRoot: root, roleId: "writer", origin: "team" });
    const worker = await registerAgent({
      repositoryRoot: root,
      roleId: "researcher",
      origin: "lervo",
    });
    expect(developer.model).toEqual({ tier: "strong", effort: "xhigh", source: "role" });
    expect(writer.model).toEqual({ tier: "balanced", effort: "medium", source: "role" });
    expect(worker.model).toBeUndefined();
    // A role the table does not name, and a record from before the field, get a strong model.
    expect(roleModel("data-steward")).toEqual({ tier: "strong", effort: "high", source: "role" });
    expect(agentModel({ roleId: "writer" })).toEqual(writer.model);
  });

  it("records the owner's choice once, and refuses Lervo's own agents and stale revisions", async () => {
    const root = await project();
    const owner = await registerAgent({ repositoryRoot: root, roleId: "researcher" });
    const changed = await changeAgentModel({
      repositoryRoot: root,
      agentId: owner.agentId,
      expectedRevision: owner.revision,
      tier: "frontier",
      effort: "max",
    });
    expect(changed).toMatchObject({
      model: { tier: "frontier", effort: "max", source: "owner" },
      revision: owner.revision + 1,
    });
    expect(
      (await listAgents(root)).find((agent) => agent.agentId === owner.agentId)?.model,
    ).toEqual(changed.model);
    await expect(
      changeAgentModel({
        repositoryRoot: root,
        agentId: owner.agentId,
        expectedRevision: owner.revision,
        tier: "fast",
        effort: "low",
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
    const worker = await registerAgent({
      repositoryRoot: root,
      roleId: "researcher",
      origin: "lervo",
    });
    await expect(
      changeAgentModel({
        repositoryRoot: root,
        agentId: worker.agentId,
        expectedRevision: worker.revision,
        tier: "fast",
        effort: "low",
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
  });
});
