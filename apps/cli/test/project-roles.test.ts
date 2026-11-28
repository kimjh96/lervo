import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  changeAgentStatus,
  createAssignment,
  createWorkforceRoleBindingMigrationPlan,
  listAgents,
  listAssignments,
} from "@lervo/agent-workforce";
import { readEffectNotices } from "@lervo/project";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { resolveRoleContract } from "@lervo/roles";
import { afterEach, describe, expect, it } from "vitest";

import { hireAgent } from "../src/agent-hire.js";
import { moveAgentToRole } from "../src/agent-role-move.js";
import { runCli } from "../src/main.js";
import { addProjectRole, editProjectRole, removeProjectRole } from "../src/project-roles.js";

const roots: string[] = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-project-roles-"));
  roots.push(root);
  const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init", "--root", root, "--name", "roles-fixture"], quiet)).toBe(0);
  return root;
}

const machining = {
  name: "Machining",
  description: "Owns machining feasibility and toolpath review.",
  from: "developer",
};

describe("project roles", () => {
  it("adds a role, moves its agents with an edit, and removes it once nothing holds it", async () => {
    const root = await project();
    const added = await addProjectRole(root, machining, undefined);
    expect(added).toMatchObject({
      roleId: "machining",
      version: "1.0.0",
      sourceKind: "repository",
    });
    const hired = await hireAgent(root, {
      roleId: "machining",
      provider: "claude",
      displayName: "Haru",
      responsibilityPaths: ["*"],
    });

    const edited = await editProjectRole(root, "machining", { name: "Machinist" }, undefined);
    expect(edited).toMatchObject({ changed: true, contract: { version: "1.1.0" } });
    // The agent moved with its role, so the registry still reads.
    expect((await listAgents(root)).find((agent) => agent.agentId === hired.agentId)).toMatchObject(
      { roleVersion: "1.1.0", roleContractHash: edited.contract.contractHash, status: "active" },
    );
    expect(
      await editProjectRole(root, "machining", { name: "Machinist" }, undefined),
    ).toMatchObject({ changed: false, contract: { version: "1.1.0" } });

    await expect(removeProjectRole(root, "machining", undefined)).rejects.toMatchObject({
      code: "role_in_use",
    });
    const moved = await moveAgentToRole(
      root,
      { agentId: hired.agentId, roleId: "developer", expectedRevision: hired.revision + 1 },
      undefined,
    );
    // Paused for the move and working again after it, with its name kept.
    expect(moved).toMatchObject({ roleId: "developer", status: "active", displayName: "Haru" });
    expect(moved.revision).toBe(hired.revision + 4);

    const removed = await removeProjectRole(root, "machining", undefined);
    expect(removed).toEqual({ roleId: "machining", version: "1.1.0" });
    await expect(resolveRoleContract(root, "machining")).rejects.toMatchObject({
      code: "role_not_found",
    });
    const notices = await readEffectNotices(root);
    expect(notices.map((notice) => notice.effect)).toEqual([
      "role_added",
      "role_edited",
      "role_removed",
    ]);
    // The removal's undo adds the kept source back.
    const undo = notices.at(-1)!.undo;
    const kept = /--source '([^']+)'/u.exec(undo)![1]!;
    await addProjectRole(
      root,
      { source: JSON.parse(await readFile(kept, "utf8")) as unknown },
      undefined,
    );
    expect((await resolveRoleContract(root, "machining")).version).toBe("1.1.0");
  });

  it("refuses built-in roles, taken names, and roles another role extends", async () => {
    const root = await project();
    await expect(
      editProjectRole(root, "developer", { name: "Dev" }, undefined),
    ).rejects.toMatchObject({ code: "role_built_in" });
    await expect(
      addProjectRole(root, { ...machining, name: "developer" }, undefined),
    ).rejects.toMatchObject({ code: "role_name_conflict" });
    await addProjectRole(root, machining, undefined);
    await expect(
      addProjectRole(root, { ...machining, roleId: "machining", name: "Other" }, undefined),
    ).rejects.toMatchObject({ code: "role_exists" });
    await addProjectRole(
      root,
      { name: "Machining Lead", description: "Leads machining.", from: "machining" },
      undefined,
    );
    await expect(
      editProjectRole(root, "machining", { description: "Changed." }, undefined),
    ).rejects.toMatchObject({ code: "role_extended" });
    await expect(removeProjectRole(root, "machining", undefined)).rejects.toMatchObject({
      code: "role_extended",
    });
  });

  it("lets an agent change the organization only as far as its role reaches", async () => {
    const root = await project();
    const owner = await hireAgent(root, {
      roleId: "product-owner",
      provider: "claude",
      displayName: "Bora",
      responsibilityPaths: ["*"],
    });
    const developer = await hireAgent(root, {
      roleId: "developer",
      provider: "claude",
      responsibilityPaths: ["*"],
    });
    // A hire without a name gets a nickname, not a specialty or a suffix. The names hired below
    // stay outside Lervo's nicknames, which this hire takes by its random ID.
    expect(developer.displayName).toMatch(/^[A-Z][a-z]+$/u);
    await expect(addProjectRole(root, machining, developer.agentId)).rejects.toMatchObject({
      code: "agent_not_authorized",
    });
    await expect(
      hireAgent(root, {
        roleId: "developer",
        provider: "claude",
        responsibilityPaths: ["*"],
        actorAgentId: developer.agentId,
      }),
    ).rejects.toMatchObject({ code: "agent_not_authorized" });
    await expect(
      moveAgentToRole(
        root,
        {
          agentId: developer.agentId,
          roleId: "product-owner",
          expectedRevision: developer.revision,
        },
        developer.agentId,
      ),
    ).rejects.toMatchObject({ code: "agent_not_authorized" });

    await addProjectRole(root, machining, owner.agentId);
    const hired = await hireAgent(root, {
      roleId: "machining",
      provider: "claude",
      displayName: "Yuna",
      responsibilityPaths: ["*"],
      actorAgentId: owner.agentId,
    });
    // The agent an agent hires is its own subagent.
    expect(hired.parentAgentId).toBe(owner.agentId);
  });

  it("keeps a retired agent and an ended assignment as history after their role goes", async () => {
    const root = await project();
    await addProjectRole(root, machining, undefined);
    const hired = await hireAgent(root, {
      roleId: "machining",
      provider: "claude",
      displayName: "Sora",
      responsibilityPaths: ["*"],
    });
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "review",
      roleId: "machining",
      acceptanceCriteria: ["Review the toolpath."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/toolpath.ts"],
    });
    await changeAgentStatus({
      repositoryRoot: root,
      agentId: hired.agentId,
      expectedRevision: hired.revision,
      status: "retired",
    });
    await expect(removeProjectRole(root, "machining", undefined)).rejects.toMatchObject({
      code: "role_in_use",
      details: { agentIds: [], assignmentIds: [assignment.assignmentId] },
    });
    const home = await resolveRepositoryCoordinationHome(root);
    const path = resolve(home.workforce, "assignments", `${assignment.assignmentId}.json`);
    const state = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    await writeFile(path, `${JSON.stringify({ ...state, status: "cancelled" }, null, 2)}\n`);

    await removeProjectRole(root, "machining", undefined);
    expect((await listAgents(root)).find((agent) => agent.agentId === hired.agentId)).toMatchObject(
      { roleId: "machining", status: "retired" },
    );
    expect(await listAssignments(root)).toEqual([
      expect.objectContaining({ assignmentId: assignment.assignmentId, status: "cancelled" }),
    ]);
    expect(await createWorkforceRoleBindingMigrationPlan(root)).toMatchObject({
      status: "current",
    });
  });

  it("adds, edits, and removes roles through `lervo role`, naming each failure's code", async () => {
    const root = await project();
    const run = async (args: string[]) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const status = await runCli(["role", ...args, "--root", root], {
        cwd: root,
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      });
      return { status, stdout: stdout.join(""), stderr: stderr.join("") };
    };
    const added = await run([
      "add",
      "--name",
      "Experience",
      "--description",
      "Owns how the product feels to use.",
      "--from",
      "designer",
      "--capability",
      "deploy=deny",
      "--write",
      "--json",
    ]);
    expect(added.status).toBe(0);
    expect(JSON.parse(added.stdout)).toMatchObject({
      role: { roleId: "experience", version: "1.0.0", name: "Experience" },
    });
    const edited = await run([
      "edit",
      "--role",
      "experience",
      "--request-types",
      "experience.review",
      "--write",
      "--json",
    ]);
    expect(JSON.parse(edited.stdout)).toMatchObject({
      changed: true,
      role: { version: "1.1.0", requestTypes: expect.arrayContaining(["experience.review"]) },
    });
    const refused = await run(["remove", "--role", "designer", "--write"]);
    expect(refused).toMatchObject({ status: 1 });
    expect(refused.stderr).toContain("Role command failed (role_built_in)");
    expect((await run(["remove", "--role", "experience", "--write"])).status).toBe(0);
  });
});
