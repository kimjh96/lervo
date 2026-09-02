import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectAssignmentCommunications } from "../src/assignment-communication-inspection.js";
import { runCli } from "../src/main.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function outputIo(root: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      cwd: root,
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
  };
}

describe("assignment communication inspection", () => {
  it("resolves one role mention through an exact handoff and rebuilds thread and inbox views", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-assignment-communication-"));
    roots.push(root);
    const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
    expect(await runCli(["init"], quiet)).toBe(0);

    const workstreamDraft = JSON.stringify({
      schemaVersion: 1,
      status: "active",
      title: "Assignment communication",
      objective: "Route one exact workforce mention.",
      nextActions: [],
      blockers: [],
      notes: [],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      updatedAt: new Date().toISOString(),
    });
    const workstreamPlanOutput = outputIo(root);
    expect(
      await runCli(["workstream", "start", "--stdin", "--json"], {
        ...workstreamPlanOutput.io,
        stdin: async () => workstreamDraft,
      }),
    ).toBe(0);
    const workstreamPlan = JSON.parse(workstreamPlanOutput.stdout.join("")) as {
      planId: string;
      snapshot: { workstreamId: string };
    };
    expect(
      await runCli(["workstream", "start", "--stdin", "--apply", workstreamPlan.planId], {
        ...quiet,
        stdin: async () => workstreamDraft,
      }),
    ).toBe(0);

    const developerOutput = outputIo(root);
    expect(
      await runCli(
        ["agent", "hire", "--role", "developer", "--write", "--json"],
        developerOutput.io,
      ),
    ).toBe(0);
    const developer = JSON.parse(developerOutput.stdout.join("")) as { agentId: string };
    const researcherOutput = outputIo(root);
    expect(
      await runCli(
        ["agent", "hire", "--role", "researcher", "--write", "--json"],
        researcherOutput.io,
      ),
    ).toBe(0);
    const researcher = JSON.parse(researcherOutput.stdout.join("")) as { agentId: string };

    const assignmentOutput = outputIo(root);
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
          "Route one mention.",
          "--suite",
          "project.quick",
          "--path",
          "src/example.ts",
          "--workstream",
          workstreamPlan.snapshot.workstreamId,
          "--write",
          "--json",
        ],
        assignmentOutput.io,
      ),
    ).toBe(0);
    const assignment = JSON.parse(assignmentOutput.stdout.join("")) as { assignmentId: string };
    const claimOutput = outputIo(root);
    expect(
      await runCli(
        [
          "assignment",
          "claim",
          "--assignment",
          assignment.assignmentId,
          "--agent",
          developer.agentId,
          "--session",
          "ses_mentionroute0001",
          "--write",
          "--json",
        ],
        claimOutput.io,
      ),
    ).toBe(0);
    const claimed = JSON.parse(claimOutput.stdout.join("")) as {
      lease: { leaseId: string };
    };

    const planOutput = outputIo(root);
    const mentionArgs = [
      "assignment",
      "mention",
      "--assignment",
      assignment.assignmentId,
      "--from-agent",
      developer.agentId,
      "--mention",
      "@role:researcher",
      "--lease",
      claimed.lease.leaseId,
      "--request-digest",
      `sha256:${"d".repeat(64)}`,
      "--artifact",
      `art_mentionroute01=sha256:${"e".repeat(64)}`,
      "--evidence-event",
      "evt_mentionroute01",
    ];
    expect(await runCli([...mentionArgs, "--json"], planOutput.io)).toBe(0);
    const routePlan = JSON.parse(planOutput.stdout.join("")) as {
      plan: { planId: string; recipientAgentId: string };
    };
    expect(routePlan.plan.recipientAgentId).toBe(researcher.agentId);

    const applyOutput = outputIo(root);
    expect(
      await runCli(
        [...mentionArgs, "--apply", routePlan.plan.planId, "--write", "--json"],
        applyOutput.io,
      ),
    ).toBe(0);
    const applied = JSON.parse(applyOutput.stdout.join("")) as { appliedHandoffId: string };
    const report = await inspectAssignmentCommunications({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      recipientAgentId: researcher.agentId,
    });

    expect(report.validity).toEqual({ status: "valid", reasonCodes: [] });
    expect(report.threads[0]!.routes[0]).toMatchObject({
      handoffId: applied.appliedHandoffId,
      fromAgentId: developer.agentId,
      toAgentId: researcher.agentId,
      routeState: "recorded",
      deliveryState: "unobserved",
    });
    expect(report.inbox[0]).toMatchObject({
      recipientAgentId: researcher.agentId,
      recipientAgentStatus: "active",
    });
  });
});
