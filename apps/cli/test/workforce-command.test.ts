import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

function io(cwd: string, stdout: string[] = [], stderr: string[] = []) {
  return {
    cwd,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("workforce CLI", () => {
  it("lists, validates, hires, and assigns a repository-specialized researcher", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-custom-role-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "custom-role-fixture"], io(root))).toBe(
      0,
    );
    await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
    await writeFile(
      resolve(root, ".lervo/roles/legal-researcher.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "lervo_repository_role",
          roleId: "legal-researcher",
          version: "1.0.0",
          extends: [{ roleId: "researcher", version: "1.0.0" }],
          profile: {
            name: "법률 연구자",
            description:
              "Researches legal sources under the built-in researcher evidence contract.",
          },
          checks: [],
        },
        null,
        2,
      )}\n`,
    );
    const roleOutput: string[] = [];
    expect(await runCli(["role", "list", "--root", root, "--json"], io(root, roleOutput))).toBe(0);
    expect(JSON.parse(roleOutput.join("")).roles).toContainEqual(
      expect.objectContaining({ roleId: "researcher", sourceKind: "built_in" }),
    );
    expect(JSON.parse(roleOutput.join("")).roles).toContainEqual(
      expect.objectContaining({ roleId: "legal-researcher", sourceKind: "repository" }),
    );
    expect(
      await runCli(["role", "validate", "--role", "legal-researcher", "--root", root], io(root)),
    ).toBe(0);

    const planOutput: string[] = [];
    expect(
      await runCli(
        ["workforce", "plan", "--request", "법률 연구자를 고용해 주세요", "--root", root, "--json"],
        io(root, planOutput),
      ),
    ).toBe(0);
    expect(JSON.parse(planOutput.join(""))).toMatchObject({
      status: "ready",
      roleId: "legal-researcher",
    });

    const agentOutput: string[] = [];
    expect(
      await runCli(
        ["agent", "hire", "--role", "legal-researcher", "--root", root, "--write", "--json"],
        io(root, agentOutput),
      ),
    ).toBe(0);
    const agent = JSON.parse(agentOutput.join(""));
    expect(agent).toMatchObject({
      roleId: "legal-researcher",
      roleVersion: "1.0.0",
      roleContractHash: expect.stringMatching(/^sha256:/u),
    });
    const assignmentOutput: string[] = [];
    expect(
      await runCli(
        [
          "assignment",
          "create",
          "--type",
          "legal.research",
          "--role",
          "legal-researcher",
          "--criteria",
          "Sources verified.",
          "--suite",
          "project.quick",
          "--path",
          "research",
          "--root",
          root,
          "--write",
          "--json",
        ],
        io(root, assignmentOutput),
      ),
    ).toBe(0);
    expect(JSON.parse(assignmentOutput.join(""))).toMatchObject({
      roleId: "legal-researcher",
      roleContractHash: agent.roleContractHash,
    });
  });

  it("hires a parent and identical subagent, then leases and completes a durable assignment", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-workforce-"));
    roots.push(root);
    await mkdir(resolve(root, "src"));
    expect(await runCli(["init", "--root", root, "--name", "workforce-fixture"], io(root))).toBe(0);
    const parentOutput: string[] = [];
    expect(
      await runCli(
        ["agent", "hire", "--role", "developer", "--provider", "codex", "--write", "--json"],
        io(root, parentOutput),
      ),
    ).toBe(0);
    const parent = JSON.parse(parentOutput.join(""));
    const childOutput: string[] = [];
    expect(
      await runCli(
        [
          "agent",
          "hire",
          "--role",
          "developer",
          "--provider",
          "claude",
          "--parent",
          parent.agentId,
          "--write",
          "--json",
        ],
        io(root, childOutput),
      ),
    ).toBe(0);
    const child = JSON.parse(childOutput.join(""));
    expect(child).toMatchObject({ parentAgentId: parent.agentId, delegationDepth: 1 });

    const assignmentOutput: string[] = [];
    expect(
      await runCli(
        [
          "assignment",
          "create",
          "--type",
          "implementation",
          "--role",
          "developer",
          "--criteria",
          "Tests pass.",
          "--suite",
          "project.quick",
          "--path",
          "src",
          "--write",
          "--json",
        ],
        io(root, assignmentOutput),
      ),
    ).toBe(0);
    const assignment = JSON.parse(assignmentOutput.join(""));
    const claimOutput: string[] = [];
    expect(
      await runCli(
        [
          "assignment",
          "claim",
          "--assignment",
          assignment.assignmentId,
          "--agent",
          child.agentId,
          "--session",
          "ses_cli_subagent_01",
          "--write",
          "--json",
        ],
        io(root, claimOutput),
      ),
    ).toBe(0);
    const claimed = JSON.parse(claimOutput.join(""));
    const completedOutput: string[] = [];
    expect(
      await runCli(
        [
          "assignment",
          "complete",
          "--assignment",
          assignment.assignmentId,
          "--agent",
          child.agentId,
          "--lease",
          claimed.lease.leaseId,
          "--verification",
          "passed",
          "--artifact",
          `art_cli_result_0001=sha256:${"d".repeat(64)}`,
          "--write",
          "--json",
        ],
        io(root, completedOutput),
      ),
    ).toBe(0);
    expect(JSON.parse(completedOutput.join(""))).toMatchObject({
      status: "completed",
      assigneeAgentId: child.agentId,
    });

    const storage = await openProjectStorage(root);
    try {
      expect(storage.events.list().map((event) => event.type)).toEqual([
        "agent.registered",
        "agent.registered",
        "assignment.created",
        "assignment.claimed",
        "assignment.completed",
      ]);
    } finally {
      await storage.close();
    }
  });
});
