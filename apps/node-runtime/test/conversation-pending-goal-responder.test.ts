import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { afterEach, expect, it } from "vitest";

import { SQLiteConversationGoalIntakeStore } from "../src/conversation-goal-intake-store.js";
import { ConversationPendingGoalResponder } from "../src/conversation-pending-goal-responder.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("retains a goal without claiming execution authority and replays it idempotently", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-pending-goal-"));
  roots.push(root);
  const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
  const content = await artifacts.put("Own this release through verification and deployment.");
  const event = createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey("pending-goal-1"),
    target: {
      integrationId: "itg_pendinggoal",
      projectId: `prj_${"a".repeat(16)}`,
      conversationId: "cnv_pendinggoal",
      threadId: null,
    },
    kind: "message.created",
    actor: { kind: "human", participantId: "ptc_requester01", roleId: null },
    mentions: { participantIds: [], roleIds: [] },
    content: {
      artifactId: `art_${content.contentHash.slice(7)}`,
      contentHash: content.contentHash,
      byteCount: content.byteCount,
      mediaType: "text/plain; charset=utf-8",
    },
    replyToEventId: null,
    signalCode: null,
    automationDepth: 0,
    occurredAt: "2026-09-16T00:00:00.000Z",
  });
  const store = SQLiteConversationGoalIntakeStore.open(resolve(root, "pending.sqlite"));
  try {
    const responder = new ConversationPendingGoalResponder({
      projectId: event.target.projectId,
      ownerAgentId: `agt_${"b".repeat(24)}`,
      artifactStore: artifacts,
      store,
      authorizedEffectRequesters: [],
      now: () => new Date("2026-09-16T00:00:01.000Z"),
    });
    const first = await responder.respond({ event } as never);
    const duplicate = await responder.respond({ event } as never);
    expect(first.content.contentHash).not.toBe(duplicate.content.contentHash);
    expect(store.listPending()).toEqual([
      {
        eventId: event.eventId,
        projectId: event.target.projectId,
        ownerAgentId: `agt_${"b".repeat(24)}`,
        contentHash: content.contentHash,
        sourceEventKeyHash: event.sourceEventKeyHash,
        conversationId: event.target.conversationId,
        threadId: null,
        requesterKind: "human",
        requesterParticipantId: "ptc_requester01",
        requesterRoleId: null,
        createdAt: "2026-09-16T00:00:01.000Z",
      },
    ]);
  } finally {
    store.close();
  }
});
