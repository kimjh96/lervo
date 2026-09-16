import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkforceRoleBindingMigration,
  createAssignment,
  createWorkforceRoleBindingMigrationPlan,
  listAgents,
  listAssignments,
  registerAgent,
  type WorkforceEvent,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-role-binding-migration-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_role_binding_migration_01" }));
  return root;
}

describe("workforce role-binding migration", () => {
  it("refreshes stale built-in agent and assignment bindings under one exact plan", async () => {
    const root = await repository();
    const agent = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["The migration is verified."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/migration.ts"],
    });
    const home = await resolveRepositoryCoordinationHome(root);
    const registryPath = resolve(home.workforce, "agents.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      agents: Array<Record<string, unknown>>;
    };
    Object.assign(registry.agents[0]!, {
      roleContractHash: `sha256:${"1".repeat(64)}`,
      roleProfileHash: `sha256:${"2".repeat(64)}`,
      capabilityHash: `sha256:${"3".repeat(64)}`,
    });
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
    const assignmentPath = resolve(
      home.workforce,
      "assignments",
      `${assignment.assignmentId}.json`,
    );
    await writeFile(
      assignmentPath,
      `${JSON.stringify(
        {
          ...assignment,
          roleContractHash: `sha256:${"4".repeat(64)}`,
          requiredCapabilityHash: `sha256:${"3".repeat(64)}`,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );

    await expect(listAgents(root)).rejects.toMatchObject({ code: "agent_state_conflict" });
    await expect(listAssignments(root)).rejects.toMatchObject({
      code: "assignment_lease_conflict",
    });
    const plan = await createWorkforceRoleBindingMigrationPlan(root);
    expect(plan).toMatchObject({
      status: "ready",
      staleAgentCount: 1,
      staleAssignmentCount: 1,
      conflictCount: 0,
    });
    const events: WorkforceEvent[] = [];
    await expect(
      applyWorkforceRoleBindingMigration({
        repositoryRoot: root,
        approval: plan.planId,
        now: new Date("2026-09-16T00:00:00.000Z"),
        recordEvent: (event) => {
          events.push(event);
        },
      }),
    ).resolves.toEqual({ migratedAgentCount: 1, migratedAssignmentCount: 1 });

    expect(await createWorkforceRoleBindingMigrationPlan(root)).toMatchObject({
      status: "current",
      staleAgentCount: 0,
      staleAssignmentCount: 0,
    });
    expect(await listAgents(root)).toEqual([
      expect.objectContaining({ agentId: agent.agentId, revision: agent.revision + 1 }),
    ]);
    expect(await listAssignments(root)).toEqual([
      expect.objectContaining({
        assignmentId: assignment.assignmentId,
        requiredCapabilityHash: expect.not.stringMatching(/^sha256:3{64}$/u),
        revision: 2,
      }),
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "assignment.role.binding.changed",
      "agent.identity.changed",
    ]);
  });

  it("rejects an approval after the bound workforce state changes", async () => {
    const root = await repository();
    const plan = await createWorkforceRoleBindingMigrationPlan(root);
    await registerAgent({ repositoryRoot: root, roleId: "developer" });
    await expect(
      applyWorkforceRoleBindingMigration({
        repositoryRoot: root,
        approval: plan.planId,
        recordEvent: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
  });

  it("requires an exact approval before refreshing repository role bindings", async () => {
    const root = await repository();
    const rolePath = resolve(root, ".lervo/roles/release-developer.json");
    await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
    const roleSource = (description: string) =>
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "lervo_repository_role",
          roleId: "release-developer",
          version: "1.0.0",
          extends: [{ roleId: "developer", version: "1.0.0" }],
          profile: { name: "Release Developer", description },
          checks: [],
        },
        null,
        2,
      )}\n`;
    await writeFile(rolePath, roleSource("Prepares verified release artifacts."));
    const agent = await registerAgent({ repositoryRoot: root, roleId: "release-developer" });
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "release-developer",
      acceptanceCriteria: ["The release artifact is verified."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["dist/release.js"],
    });
    await writeFile(rolePath, roleSource("Prepares verified and reproducible release artifacts."));
    const preservedRoleSource = await readFile(rolePath, "utf8");

    const plan = await createWorkforceRoleBindingMigrationPlan(root);
    expect(plan).toMatchObject({
      status: "review_required",
      staleAgentCount: 1,
      staleAssignmentCount: 1,
      conflictCount: 0,
      requiredApprovals: [
        {
          roleId: "release-developer",
          roleVersion: "1.0.0",
          staleAgentCount: 1,
          staleAssignmentCount: 1,
        },
      ],
    });
    await expect(
      applyWorkforceRoleBindingMigration({
        repositoryRoot: root,
        approval: plan.planId,
        recordEvent: () => undefined,
      }),
    ).resolves.toEqual({ migratedAgentCount: 0, migratedAssignmentCount: 0 });
    expect((await createWorkforceRoleBindingMigrationPlan(root)).status).toBe("review_required");

    const required = plan.requiredApprovals[0]!;
    await expect(
      applyWorkforceRoleBindingMigration({
        repositoryRoot: root,
        approval: plan.planId,
        approvedRoleBindings: [
          { operationId: required.operationId, approvalHash: `sha256:${"0".repeat(64)}` },
        ],
        recordEvent: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });

    const events: WorkforceEvent[] = [];
    await expect(
      applyWorkforceRoleBindingMigration({
        repositoryRoot: root,
        approval: plan.planId,
        approvedRoleBindings: [required],
        now: new Date("2026-09-16T01:00:00.000Z"),
        recordEvent: (event) => {
          events.push(event);
        },
      }),
    ).resolves.toEqual({ migratedAgentCount: 1, migratedAssignmentCount: 1 });
    expect(await createWorkforceRoleBindingMigrationPlan(root)).toMatchObject({
      status: "current",
      requiredApprovals: [],
    });
    expect(await listAgents(root)).toEqual([
      expect.objectContaining({ agentId: agent.agentId, revision: agent.revision + 1 }),
    ]);
    expect(await listAssignments(root)).toEqual([
      expect.objectContaining({ assignmentId: assignment.assignmentId, revision: 2 }),
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "assignment.role.binding.changed",
      "agent.identity.changed",
    ]);
    expect(await readFile(rolePath, "utf8")).toBe(preservedRoleSource);
  });
});
