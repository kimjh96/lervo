import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  createConversationParticipationDecision,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { SQLiteConversationInteractionStore } from "@lervo/interaction-sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { SQLiteConversationHistory } from "../src/conversation-history.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("SQLite conversation history", () => {
  it("retains prior human anchors when recent agent chatter fills the ordinary window", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const path = resolve(root, "interaction.sqlite");
    const store = await SQLiteConversationInteractionStore.open({ path });
    const policy = createConversationParticipationPolicy({
      projectId: "prj_history01",
      roleId: "observer",
      conversationIds: ["cnv_history01"],
      mode: "relevant",
      respondTo: ["agent", "human"],
      signalCodes: [],
      cooldownSeconds: 0,
      maxResponsesPerHour: 20,
      maxAutomationDepth: 2,
      createdAt: "2026-09-17T00:00:00.000Z",
    });
    const events = [];
    for (let index = 0; index < 11; index += 1) {
      const text =
        index === 0
          ? "이 설계는 네 플랫폼의 장점을 Lervo 코어에 통합한다."
          : `에이전트 상태 ${index}`;
      const content = await artifactStore.put(text);
      const occurredAt = `2026-09-17T00:00:${String(index + 1).padStart(2, "0")}.000Z`;
      const event = createConversationInboundEvent({
        sourceEventKeyHash: hashConversationSourceEventKey(`history-${index}`),
        target: {
          integrationId: "itg_history01",
          projectId: "prj_history01",
          conversationId: "cnv_history01",
          threadId: null,
        },
        kind: "message.created",
        actor:
          index === 0
            ? { kind: "human", participantId: "ptc_human001", roleId: null }
            : { kind: "agent", participantId: "ptc_agent001", roleId: "reviewer" },
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
        occurredAt,
      });
      const claim = await store.claimInbound({
        event,
        policy,
        workerId: "history-worker",
        claimedAt: occurredAt,
        leaseDurationMs: 60_000,
      });
      if (claim.status !== "claimed") throw new Error("History fixture claim failed.");
      await store.completeInbound({
        eventId: event.eventId,
        policyId: policy.policyId,
        roleId: policy.roleId,
        leaseId: claim.leaseId,
        decision: createConversationParticipationDecision({
          event,
          policy,
          action: "observe",
          reason: "turn_not_owned",
          relevance: "not_checked",
          decidedAt: occurredAt,
        }),
        outbound: null,
      });
      events.push(event);
    }
    await store.close();

    const turns = await new SQLiteConversationHistory(path, artifactStore).recent(events.at(-1)!);

    expect(turns).toHaveLength(9);
    expect(turns[0]).toMatchObject({
      text: "이 설계는 네 플랫폼의 장점을 Lervo 코어에 통합한다.",
      speaker: { kind: "human", participantId: "ptc_human001" },
    });
    expect(turns.slice(1).every((turn) => turn.speaker.kind === "agent")).toBe(true);
  });
});
