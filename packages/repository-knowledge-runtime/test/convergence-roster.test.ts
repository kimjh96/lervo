import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  claimAssignment,
  createAssignment,
  listAgents,
  registerAgent,
  type WorkforceEvent,
} from "@lervo/agent-workforce";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  convergenceAgentName,
  convergenceDelegationAgentIds,
  lervoAgentIds,
  retireSupersededConvergenceAgents,
} from "../src/convergence-roster.js";
import type { ConvergenceDelegation } from "../src/delegation-contract.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const oldHash = `sha256:${"a".repeat(64)}`;
const currentHash = `sha256:${"b".repeat(64)}`;

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-convergence-roster-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_convergence_roster",
      now: new Date("2026-08-25T00:00:00.000Z"),
    }),
  );
  const owner = await registerAgent({ repositoryRoot: root, roleId: "ceo", provider: "codex" });
  const delegation = {
    parentAgentId: owner.agentId,
    roles: {
      generator: { roleId: "developer" },
      reviewer: { roleId: "developer" },
      writer: { roleId: "developer" },
      integrator: { roleId: "developer" },
    },
  } as unknown as ConvergenceDelegation;
  const hire = (displayName: string) =>
    registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "codex",
      parentAgentId: owner.agentId,
      displayName,
    });
  return { root, owner, delegation, hire };
}

describe("convergence worker roster", () => {
  it("retires idle workers of superseded delegations and keeps busy, current and staff agents", async () => {
    const f = await fixture();
    const oldGenerator = await f.hire(convergenceAgentName("generator", oldHash));
    const oldReviewer = await f.hire(convergenceAgentName("reviewer", oldHash));
    const oldWriter = await f.hire(`${convergenceAgentName("writer", oldHash)} 0123abcd`);
    const current = await f.hire(convergenceAgentName("generator", currentHash));
    const staff = await f.hire("Niko");
    const assignment = await createAssignment({
      repositoryRoot: f.root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["Work continues."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src"],
    });
    await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: assignment.assignmentId,
      agentId: oldReviewer.agentId,
      sessionId: "ses_convergence_roster",
    });
    const events: WorkforceEvent[] = [];
    const retired = await retireSupersededConvergenceAgents({
      repositoryRoot: f.root,
      delegation: f.delegation,
      delegationHash: currentHash,
      recordEvent: (event) => void events.push(event),
    });
    expect(retired.sort()).toEqual([oldGenerator.agentId, oldWriter.agentId].sort());
    expect(events.map((event) => event.type)).toEqual([
      "agent.status.changed",
      "agent.status.changed",
    ]);
    const status = new Map(
      (await listAgents(f.root)).map((agent) => [agent.agentId, agent.status]),
    );
    expect(status.get(oldReviewer.agentId)).toBe("active");
    expect(status.get(current.agentId)).toBe("active");
    expect(status.get(staff.agentId)).toBe("active");
    expect(status.get(f.owner.agentId)).toBe("active");
  });

  it("separates the delegation's workers from staff when counting the parent's headcount", async () => {
    const f = await fixture();
    const current = await f.hire(convergenceAgentName("integrator", currentHash));
    const staff = await f.hire("Knowledge base curator");
    const lookalike = await registerAgent({
      repositoryRoot: f.root,
      roleId: "writer",
      provider: "codex",
      parentAgentId: f.owner.agentId,
      displayName: convergenceAgentName("writer", currentHash),
    });
    const ids = convergenceDelegationAgentIds(await listAgents(f.root), f.delegation);
    expect([...ids]).toEqual([current.agentId]);
    expect(ids.has(staff.agentId)).toBe(false);
    // A matching name with a role other than the delegation's binding is staff.
    expect(ids.has(lookalike.agentId)).toBe(false);
  });

  it("tells Lervo's own agents from the project's team", async () => {
    const { root, owner, delegation, hire } = await fixture();
    const worker = await hire(convergenceAgentName("reviewer", currentHash));
    const team = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "claude",
    });
    const teamChild = await registerAgent({
      repositoryRoot: root,
      roleId: "researcher",
      provider: "claude",
      parentAgentId: team.agentId,
    });
    const steward = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "codex",
      displayName: "Knowledge Steward",
    });
    const agents = await listAgents(root);
    expect([...lervoAgentIds(agents, delegation)].sort()).toEqual(
      [owner.agentId, worker.agentId, steward.agentId].sort(),
    );
    // Without a delegation, workers and the steward are still Lervo's; their parent is not.
    expect([...lervoAgentIds(agents, null)].sort()).toEqual(
      [worker.agentId, steward.agentId].sort(),
    );
    expect(lervoAgentIds(agents, delegation).has(teamChild.agentId)).toBe(false);
  });
});
