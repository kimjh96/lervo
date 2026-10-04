import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyWorkforceRoleBindingMigration,
  changeAgentStatus,
  claimAssignment,
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
  it("keeps retired custom-role history inspectable without weakening active claims", async () => {
    const root = await repository();
    const rolePath = resolve(root, ".lervo/roles/archived-reviewer.json");
    await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
    const roleSource = `${JSON.stringify({
      schemaVersion: 1,
      kind: "lervo_repository_role",
      roleId: "archived-reviewer",
      version: "1.0.0",
      extends: [{ roleId: "developer", version: "1.0.0" }],
      profile: { name: "Archived Reviewer", description: "Reviews historical repository work." },
      checks: [],
    })}\n`;
    await writeFile(rolePath, roleSource);
    const retired = await registerAgent({ repositoryRoot: root, roleId: "archived-reviewer" });
    await rm(rolePath);
    await expect(listAgents(root)).rejects.toMatchObject({ code: "role_not_found" });
    await writeFile(rolePath, roleSource);
    await changeAgentStatus({
      repositoryRoot: root,
      agentId: retired.agentId,
      expectedRevision: retired.revision,
      status: "retired",
    });
    await rm(rolePath);

    const active = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const agents = await listAgents(root);
    expect(agents).toHaveLength(2);
    expect(agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: retired.agentId,
          roleId: "archived-reviewer",
          status: "retired",
          roleContractHash: retired.roleContractHash,
        }),
        expect.objectContaining({ agentId: active.agentId, roleId: "developer", status: "active" }),
      ]),
    );
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "review",
      roleId: "developer",
      acceptanceCriteria: ["Review the source-bound change."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/change.ts"],
    });
    await expect(
      claimAssignment({
        repositoryRoot: root,
        assignmentId: assignment.assignmentId,
        agentId: active.agentId,
        sessionId: "ses_archived_role_claim_01",
      }),
    ).resolves.toMatchObject({ status: "leased", assigneeAgentId: active.agentId });
    await expect(
      changeAgentStatus({
        repositoryRoot: root,
        agentId: retired.agentId,
        expectedRevision: retired.revision + 1,
        status: "active",
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
  });

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

  it("records a null previous display name when migrating a legacy agent", async () => {
    const root = await repository();
    const agent = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const home = await resolveRepositoryCoordinationHome(root);
    const registryPath = resolve(home.workforce, "agents.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      agents: Array<Record<string, unknown>>;
    };
    // Agents registered before display identities have no stored display name.
    delete registry.agents[0]!.displayName;
    delete registry.agents[0]!.displayNameSource;
    Object.assign(registry.agents[0]!, { roleContractHash: `sha256:${"1".repeat(64)}` });
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
    const plan = await createWorkforceRoleBindingMigrationPlan(root);
    const events: WorkforceEvent[] = [];
    const undefinedValue = (value: unknown): boolean =>
      value === undefined ||
      (value !== null &&
        typeof value === "object" &&
        Object.values(value as Record<string, unknown>).some(undefinedValue));
    await applyWorkforceRoleBindingMigration({
      repositoryRoot: root,
      approval: plan.planId,
      recordEvent: (event) => {
        // Canonical event storage rejects undefined payload values.
        if (undefinedValue(event.payload))
          throw new Error(
            `undefined event payload value: ${Object.entries(event.payload)
              .filter(([, value]) => value === undefined)
              .map(([key]) => key)
              .join(",")}`,
          );
        events.push(event);
      },
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "agent.identity.changed",
        payload: expect.objectContaining({ agentId: agent.agentId, previousDisplayName: null }),
      }),
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
