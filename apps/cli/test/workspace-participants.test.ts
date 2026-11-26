import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { changeAgentStatus, registerAgent } from "@lervo/agent-workforce";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import { resolveParticipants } from "../src/workspace-participants.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-participants-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_participants",
      now: new Date("2026-11-26T00:00:00Z"),
    }),
  );
  return root;
}

describe("a conversation's participants", () => {
  it("takes active team agents, the first one writing", async () => {
    const root = await project();
    const owner = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      origin: "team",
    });
    const researcher = await registerAgent({
      repositoryRoot: root,
      roleId: "researcher",
      origin: "team",
    });
    expect(await resolveParticipants(root, undefined)).toBeUndefined();
    expect(await resolveParticipants(root, [researcher.agentId, owner.agentId])).toEqual({
      agentId: researcher.agentId,
      participants: [researcher.agentId, owner.agentId],
    });
  });

  it("refuses Lervo's agents, retired agents, unknown IDs, repeats, and an empty list", async () => {
    const root = await project();
    const team = await registerAgent({ repositoryRoot: root, roleId: "developer", origin: "team" });
    const lervo = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      origin: "lervo",
    });
    const retired = await registerAgent({ repositoryRoot: root, roleId: "writer", origin: "team" });
    await changeAgentStatus({
      repositoryRoot: root,
      agentId: retired.agentId,
      status: "retired",
      expectedRevision: retired.revision,
    });
    for (const requested of [
      [lervo.agentId],
      [retired.agentId],
      [`agt_${"f".repeat(24)}`],
      [team.agentId, team.agentId],
      [],
      "agt_x",
    ])
      await expect(resolveParticipants(root, requested)).rejects.toMatchObject({
        code: "participant_invalid",
      });
  });
});
