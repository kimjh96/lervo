import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { calculateConversationDeliberationOriginBindingDigest } from "@lervo/conversation-deliberation-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectConversationDeliberationQueues,
  SQLiteConversationDeliberationJobStore,
} from "../src/index.js";

const roots: string[] = [];
const projectId = "prj_queue_inspection";
const deliberationId = "dlb_queue_inspection";
const sourceEventId = `cve_${"a".repeat(64)}`;
const hash = (value: string) => `sha256:${value.repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation deliberation read-only inspection", () => {
  it("reads an exact origin and terminal notification without creating a resume queue", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-deliberation-inspection-"));
    roots.push(root);
    const startPath = resolve(root, "deliberations.sqlite");
    const resumePath = resolve(root, "deliberation-resumes.sqlite");
    const store = await SQLiteConversationDeliberationJobStore.open({ path: startPath });
    await store.enqueue({
      projectId,
      sourceEventId,
      deliberationId,
      requestHash: hash("1"),
      principalHash: hash("2"),
      origin: {
        conversationId: "cnv_queue_inspection",
        threadId: "thd_queue_inspection",
        requesterParticipantId: "ptc_queue_requester",
        originBindingDigest: calculateConversationDeliberationOriginBindingDigest({
          projectId,
          sourceEventId,
          conversationId: "cnv_queue_inspection",
          threadId: "thd_queue_inspection",
          requesterParticipantId: "ptc_queue_requester",
        }),
      },
      policyId: "deliberation_queue_inspection",
      topic: "Inspect the queue.",
      requestedAt: "2026-09-17T00:00:00.000Z",
    });
    const lease = await store.claim({
      workerId: "inspection-worker",
      claimedAt: "2026-09-17T00:00:01.000Z",
      leaseDurationMs: 60_000,
    });
    await store.settle({
      deliberationId,
      leaseId: lease!.leaseId,
      settledAt: "2026-09-17T00:00:02.000Z",
      summary: { deliberationId, status: "converged", artifactCount: 4, nextAction: "none" },
    });
    store.close();

    const result = await inspectConversationDeliberationQueues({
      startPath,
      resumePath,
      projectId,
      deliberationId,
    });

    expect(result.start).toMatchObject({
      deliberationId,
      state: "settled",
      origin: { conversationId: "cnv_queue_inspection", threadId: "thd_queue_inspection" },
    });
    expect(result.startNotification).toMatchObject({
      operation: "start",
      state: "pending",
      occurredAt: "2026-09-17T00:00:02.000Z",
    });
    expect(result.resume).toBeNull();
    expect(result.resumeNotification).toBeNull();
  });
});
