import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { reviewedMessageFileTriggerDescriptor } from "../src/assignment-message-trigger-adapter.js";
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

describe("assignment message trigger command", () => {
  it("routes one reviewed direct-message artifact and converges replay without another handoff", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-assignment-message-trigger-"));
    roots.push(root);
    const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
    expect(await runCli(["init"], quiet)).toBe(0);

    const draft = JSON.stringify({
      schemaVersion: 1,
      status: "active",
      title: "Reviewed message trigger",
      objective: "Route one reviewed direct message into a workforce handoff.",
      nextActions: [],
      blockers: [],
      notes: [],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      updatedAt: "2026-09-05T00:00:00.000Z",
    });
    const workstreamOutput = outputIo(root);
    expect(
      await runCli(["workstream", "start", "--stdin", "--json"], {
        ...workstreamOutput.io,
        stdin: async () => draft,
      }),
    ).toBe(0);
    const workstream = JSON.parse(workstreamOutput.stdout.join("")) as {
      planId: string;
      projectId: string;
      snapshot: { workstreamId: string };
    };
    expect(
      await runCli(["workstream", "start", "--stdin", "--apply", workstream.planId], {
        ...quiet,
        stdin: async () => draft,
      }),
    ).toBe(0);

    const agentIds: string[] = [];
    for (const role of ["developer", "writer"]) {
      const output = outputIo(root);
      expect(await runCli(["agent", "hire", "--role", role, "--write", "--json"], output.io)).toBe(
        0,
      );
      agentIds.push((JSON.parse(output.stdout.join("")) as { agentId: string }).agentId);
    }
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
          "Route the reviewed message.",
          "--suite",
          "project.quick",
          "--path",
          "src/message.ts",
          "--workstream",
          workstream.snapshot.workstreamId,
          "--write",
          "--json",
        ],
        assignmentOutput.io,
      ),
    ).toBe(0);
    const assignmentId = (JSON.parse(assignmentOutput.stdout.join("")) as { assignmentId: string })
      .assignmentId;
    const claimOutput = outputIo(root);
    expect(
      await runCli(
        [
          "assignment",
          "claim",
          "--assignment",
          assignmentId,
          "--agent",
          agentIds[0]!,
          "--session",
          "ses_reviewed_message_01",
          "--write",
          "--json",
        ],
        claimOutput.io,
      ),
    ).toBe(0);
    const leaseId = (JSON.parse(claimOutput.stdout.join("")) as { lease: { leaseId: string } })
      .lease.leaseId;
    const request = {
      schemaVersion: 1,
      adapterId: reviewedMessageFileTriggerDescriptor.adapterId,
      assignmentId,
      leaseId,
      source: {
        schemaVersion: 1,
        kind: "direct_message",
        eventId: `cve_${"1".repeat(64)}`,
        sourceEventKeyHash: `sha256:${"2".repeat(64)}`,
        projectId: workstream.projectId,
        workstreamId: workstream.snapshot.workstreamId,
        fromAgentId: agentIds[0],
        toAgentId: agentIds[1],
        content: {
          artifactId: "art_reviewed_message_01",
          contentHash: `sha256:${"3".repeat(64)}`,
        },
        occurredAt: "2026-09-05T00:01:00.000Z",
      },
      contextEvidenceEventIds: [],
    };
    const requestPath = resolve(root, "message-trigger.json");
    await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
    const args = ["assignment", "trigger", "--from", requestPath];
    const planOutput = outputIo(root);
    const planCode = await runCli([...args, "--json"], planOutput.io);
    expect(planOutput.stderr).toEqual([]);
    expect(planCode, planOutput.stdout.join("")).toBe(0);
    const planned = JSON.parse(planOutput.stdout.join("")) as {
      plan: { planId: string; status: string; descriptorHash: string };
    };
    expect(planned.plan).toMatchObject({
      status: "ready",
      descriptorHash: reviewedMessageFileTriggerDescriptor.descriptorHash,
    });

    const applyOutput = outputIo(root);
    expect(
      await runCli([...args, "--apply", planned.plan.planId, "--write", "--json"], applyOutput.io),
    ).toBe(0);
    const applied = JSON.parse(applyOutput.stdout.join("")) as { handoffId: string };
    expect(applied.handoffId).toMatch(/^hnd_[a-f0-9]{24}$/u);

    const replayOutput = outputIo(root);
    expect(await runCli([...args, "--json"], replayOutput.io)).toBe(0);
    const replay = JSON.parse(replayOutput.stdout.join("")) as {
      plan: { status: string; disposition: string };
      handoffId: string;
    };
    expect(replay).toMatchObject({
      plan: { status: "current", disposition: "already_recorded" },
      handoffId: applied.handoffId,
    });

    const storage = await openProjectStorage(root);
    try {
      const handoffEvents = storage.events
        .list({ afterSeq: 0, limit: 100 })
        .filter((event) => event.type === "assignment.handoff.recorded");
      expect(handoffEvents).toHaveLength(1);
      expect(handoffEvents[0]!.payload).toMatchObject({
        triggerKind: "reviewed_direct_message",
        triggerAdapterId: reviewedMessageFileTriggerDescriptor.adapterId,
        triggerSourceEventId: request.source.eventId,
      });
    } finally {
      await storage.close();
    }
  });
});
