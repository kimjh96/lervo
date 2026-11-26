import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  listAgents,
  recordAgentOrigins,
  registerAgent,
  type WorkforceEvent,
} from "../src/index.js";
import { validAgent } from "../src/workforce-state-validation.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-origin-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_agent_origin",
      now: new Date("2026-11-26T00:00:00.000Z"),
    }),
  );
  return root;
}

describe("an agent's origin (ADR-0643)", () => {
  it("records the origin a hire names, and carries it in the registration event", async () => {
    const root = await project();
    const events: WorkforceEvent[] = [];
    const team = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "claude",
      origin: "team",
      recordEvent: async (event) => {
        events.push(event);
      },
    });
    const unmarked = await registerAgent({ repositoryRoot: root, roleId: "researcher" });
    const agents = await listAgents(root);
    expect(agents.find((agent) => agent.agentId === team.agentId)?.origin).toBe("team");
    expect(agents.find((agent) => agent.agentId === unmarked.agentId)?.origin).toBeUndefined();
    expect(events[0]?.payload).toMatchObject({ agentId: team.agentId, origin: "team" });
  });

  it("refuses an unknown origin", () => {
    const agent = {
      schemaVersion: 1,
      agentId: `agt_${"a".repeat(24)}`,
      projectId: "prj_agent_origin",
      roleId: "developer",
      roleProfileHash: `sha256:${"b".repeat(64)}`,
      capabilityHash: `sha256:${"c".repeat(64)}`,
      provider: "claude",
      skillIds: [],
      responsibilityPaths: ["*"],
      parentAgentId: null,
      delegationDepth: 0,
      status: "active",
      revision: 1,
      createdAt: "2026-11-26T00:00:00.000Z",
      updatedAt: "2026-11-26T00:00:00.000Z",
    };
    expect(validAgent({ ...agent, origin: "lervo" }, "prj_agent_origin")).toBe(true);
    expect(validAgent(agent, "prj_agent_origin")).toBe(true);
    expect(validAgent({ ...agent, origin: "vendor" }, "prj_agent_origin")).toBe(false);
  });

  it("fills only the origins that are missing, once", async () => {
    const root = await project();
    const marked = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      origin: "team",
    });
    const unmarked = await registerAgent({ repositoryRoot: root, roleId: "researcher" });
    const origins = new Map([
      [marked.agentId, "lervo" as const],
      [unmarked.agentId, "lervo" as const],
    ]);
    expect(await recordAgentOrigins({ repositoryRoot: root, origins })).toEqual({
      recordedCount: 1,
    });
    const agents = await listAgents(root);
    expect(agents.find((agent) => agent.agentId === marked.agentId)?.origin).toBe("team");
    expect(agents.find((agent) => agent.agentId === unmarked.agentId)?.origin).toBe("lervo");
    expect(await recordAgentOrigins({ repositoryRoot: root, origins })).toEqual({
      recordedCount: 0,
    });
  });
});
