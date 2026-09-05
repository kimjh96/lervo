import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  acknowledgeAssignmentHandoff,
  claimAssignment,
  createAssignment,
  listAssignments,
  recordAssignmentHandoff,
  registerAgent,
  type WorkforceEvent,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-handoff-acknowledgement-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_handoff_acknowledgement_01",
      now: new Date("2026-09-05T00:00:00.000Z"),
    }),
  );
  return root;
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("assignment handoff acknowledgement", () => {
  it("records the exact recipient acknowledgement once without inferring delivery or action", async () => {
    const root = await repository();
    const events: WorkforceEvent[] = [];
    const source = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const recipient = await registerAgent({ repositoryRoot: root, roleId: "writer" });
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["The message route is reviewable."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src"],
    });
    const claimed = await claimAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      agentId: source.agentId,
      sessionId: "ses_handoff_ack_source_01",
      now: new Date("2026-09-05T00:01:00.000Z"),
    });
    const routed = await recordAssignmentHandoff({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      fromAgentId: source.agentId,
      toAgentId: recipient.agentId,
      leaseId: claimed.lease!.leaseId,
      requestDigest: `sha256:${"a".repeat(64)}`,
      artifactReferences: [
        { artifactId: "art_direct_message_01", contentHash: `sha256:${"a".repeat(64)}` },
      ],
      contextEvidenceEventIds: [],
      trigger: {
        kind: "reviewed_direct_message",
        adapterId: "lervo/reviewed-message-file",
        adapterVersion: "1.0.0",
        descriptorHash: `sha256:${"b".repeat(64)}`,
        sourceEventId: `cve_${"c".repeat(64)}`,
        sourceEventKeyHash: `sha256:${"d".repeat(64)}`,
      },
      now: new Date("2026-09-05T00:02:00.000Z"),
      recordEvent: (event) => {
        events.push(event);
      },
    });
    const handoff = routed.handoffs[0]!;

    await expect(
      acknowledgeAssignmentHandoff({
        repositoryRoot: root,
        assignmentId: assignment.assignmentId,
        handoffId: handoff.handoffId,
        recipientAgentId: source.agentId,
        now: new Date("2026-09-05T00:03:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });

    await expect(
      acknowledgeAssignmentHandoff({
        repositoryRoot: root,
        assignmentId: assignment.assignmentId,
        handoffId: handoff.handoffId,
        recipientAgentId: recipient.agentId,
        now: new Date("2026-09-05T00:03:00.000Z"),
        recordEvent: () => {
          throw new Error("fixture event failure");
        },
      }),
    ).rejects.toMatchObject({ code: "workforce_write_failed" });
    expect((await listAssignments(root))[0]!.handoffs[0]!.acknowledgedAt).toBeNull();

    const acknowledged = await acknowledgeAssignmentHandoff({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      handoffId: handoff.handoffId,
      recipientAgentId: recipient.agentId,
      now: new Date("2026-09-05T00:03:00.000Z"),
      recordEvent: (event) => {
        events.push(event);
      },
    });
    expect(acknowledged.handoffs[0]).toMatchObject({
      acknowledgedAt: "2026-09-05T00:03:00.000Z",
      trigger: { sourceEventKeyHash: `sha256:${"d".repeat(64)}` },
    });
    expect(events.map((event) => event.type)).toEqual([
      "assignment.handoff.recorded",
      "assignment.handoff.acknowledged",
    ]);
    expect(events[1]).toMatchObject({
      actorAgentId: recipient.agentId,
      payload: {
        assignmentId: assignment.assignmentId,
        handoffId: handoff.handoffId,
        recipientAgentId: recipient.agentId,
        acknowledgedAt: "2026-09-05T00:03:00.000Z",
      },
    });

    const replay = await acknowledgeAssignmentHandoff({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      handoffId: handoff.handoffId,
      recipientAgentId: recipient.agentId,
      now: new Date("2026-09-05T00:04:00.000Z"),
      recordEvent: (event) => {
        events.push(event);
      },
    });
    expect(replay.revision).toBe(acknowledged.revision);
    expect(events).toHaveLength(2);
  });

  it("deduplicates one reviewed message source event before another handoff is recorded", async () => {
    const root = await repository();
    const source = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const recipient = await registerAgent({ repositoryRoot: root, roleId: "writer" });
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["Replay is bounded."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src"],
    });
    const claimed = await claimAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      agentId: source.agentId,
      sessionId: "ses_handoff_dedupe_01",
      now: new Date("2026-09-05T00:01:00.000Z"),
    });
    const trigger = {
      kind: "reviewed_direct_message" as const,
      adapterId: "lervo/reviewed-message-file",
      adapterVersion: "1.0.0",
      descriptorHash: `sha256:${"b".repeat(64)}`,
      sourceEventId: `cve_${"c".repeat(64)}`,
      sourceEventKeyHash: `sha256:${"d".repeat(64)}`,
    };
    const input = {
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      fromAgentId: source.agentId,
      toAgentId: recipient.agentId,
      leaseId: claimed.lease!.leaseId,
      requestDigest: `sha256:${"a".repeat(64)}`,
      artifactReferences: [
        { artifactId: "art_direct_message_01", contentHash: `sha256:${"a".repeat(64)}` },
      ],
      contextEvidenceEventIds: [] as string[],
      trigger,
      now: new Date("2026-09-05T00:02:00.000Z"),
    };
    const first = await recordAssignmentHandoff(input);
    const replay = await recordAssignmentHandoff(input);

    expect(replay.revision).toBe(first.revision);
    expect(replay.handoffs).toHaveLength(1);
  });
});
