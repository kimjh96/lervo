import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  changeAgentStatus,
  listAgents,
  pruneRetiredLervoAgents,
  registerAgent,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-retention-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_agent_retention",
      now: new Date("2026-11-26T00:00:00.000Z"),
    }),
  );
  return root;
}

async function retiredLervoWorker(root: string, minute: number, parentAgentId?: string) {
  const at = new Date(Date.UTC(2026, 10, 26, 0, minute));
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "researcher",
    origin: "lervo",
    now: at,
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  });
  await changeAgentStatus({
    repositoryRoot: root,
    agentId: agent.agentId,
    expectedRevision: agent.revision,
    status: "retired",
    now: at,
  });
  return agent.agentId;
}

describe("Lervo's retired agents (ADR-0643)", () => {
  it("keeps the latest retired ones and never removes the team's or a named parent", async () => {
    const root = await project();
    const team = await registerAgent({ repositoryRoot: root, roleId: "developer", origin: "team" });
    await changeAgentStatus({
      repositoryRoot: root,
      agentId: team.agentId,
      expectedRevision: team.revision,
      status: "retired",
    });
    const at = new Date(Date.UTC(2026, 10, 26, 0, 0));
    const parentAgent = await registerAgent({
      repositoryRoot: root,
      roleId: "researcher",
      origin: "lervo",
      now: at,
    });
    const parent = parentAgent.agentId;
    const workers: string[] = [];
    for (let minute = 1; minute <= 5; minute++)
      workers.push(await retiredLervoWorker(root, minute, minute === 1 ? parent : undefined));
    // The parent retires before its children, the oldest of all.
    await changeAgentStatus({
      repositoryRoot: root,
      agentId: parent,
      expectedRevision: parentAgent.revision,
      status: "retired",
      now: at,
    });
    const { prunedAgentIds } = await pruneRetiredLervoAgents({ repositoryRoot: root, keep: 2 });
    // Kept: the two latest workers, the team agent, and the parent its child still named then.
    expect(new Set(prunedAgentIds)).toEqual(new Set([workers[0], workers[1], workers[2]]));
    const left = new Set((await listAgents(root)).map((agent) => agent.agentId));
    expect(left).toEqual(new Set([team.agentId, parent, workers[3], workers[4]]));
    // With its child gone, the parent is just an older retired agent.
    expect(
      (await pruneRetiredLervoAgents({ repositoryRoot: root, keep: 2 })).prunedAgentIds,
    ).toEqual([parent]);
    expect(
      (await pruneRetiredLervoAgents({ repositoryRoot: root, keep: 2 })).prunedAgentIds,
    ).toEqual([]);
  });

  it("counts the team's and Lervo's agents against separate bounds", async () => {
    const root = await project();
    const lervo = await registerAgent({
      repositoryRoot: root,
      roleId: "researcher",
      origin: "lervo",
    });
    const team = await registerAgent({ repositoryRoot: root, roleId: "developer", origin: "team" });
    expect((await listAgents(root)).map((agent) => agent.origin).sort()).toEqual(["lervo", "team"]);
    expect([lervo.origin, team.origin]).toEqual(["lervo", "team"]);
  });
});
