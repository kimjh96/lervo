import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  createConversationParticipationDecision,
  createConversationParticipationPolicy,
  createConversationOutboundMessage,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { SQLiteConversationInteractionStore } from "@lervo/interaction-sqlite";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";
import { afterEach, describe, expect, it } from "vitest";

import { SQLiteConversationHistory } from "../src/conversation-history.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("SQLite conversation history", () => {
  it("retains prior human anchors and only delivered replies observed before ingress", async () => {
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

    const replyContent = await artifactStore.put("Fourth task: repair backup capacity safely.");
    const permitInput = {
      schemaVersion: 1 as const,
      surface: "chat" as const,
      artifactId: `art_${replyContent.contentHash.slice(7)}`,
      contentHash: replyContent.contentHash,
      writingPolicyId: "writing_en-human",
      writingPolicyHash: `sha256:${"a".repeat(64)}`,
      evaluationId: "wre_history01",
      evaluationHash: `sha256:${"b".repeat(64)}`,
      issuedAt: "2026-09-17T00:00:09.100Z",
    };
    const reply = createConversationOutboundMessage({
      event: events[8]!,
      policy,
      participantId: "ptc_owner0001",
      content: {
        artifactId: permitInput.artifactId,
        contentHash: replyContent.contentHash,
        byteCount: replyContent.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      publicationPermit: {
        ...permitInput,
        permitId: calculateWritingPublicationPermitId(permitInput),
      },
      createdAt: "2026-09-17T00:00:09.500Z",
    });
    const pendingContent = await artifactStore.put("Do not treat this unsent reply as context.");
    const pendingPermitInput = {
      ...permitInput,
      artifactId: `art_${pendingContent.contentHash.slice(7)}`,
      contentHash: pendingContent.contentHash,
      issuedAt: "2026-09-17T00:00:10.100Z",
    };
    const pending = createConversationOutboundMessage({
      event: events[9]!,
      policy,
      participantId: "ptc_owner0001",
      content: {
        artifactId: pendingPermitInput.artifactId,
        contentHash: pendingContent.contentHash,
        byteCount: pendingContent.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      publicationPermit: {
        ...pendingPermitInput,
        permitId: calculateWritingPublicationPermitId(pendingPermitInput),
      },
      createdAt: "2026-09-17T00:00:10.500Z",
    });
    const database = new DatabaseSync(path);
    try {
      database
        .prepare(
          `INSERT INTO conversation_outbox (
            outbound_id, source_event_id, policy_id, role_id, integration_id, project_id,
            conversation_id, outbound_json, status, available_at_ms, attempt_count,
            lease_id, lease_owner, lease_expires_at_ms, last_failure_code, last_failed_at_ms,
            receipt_json, delivered_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, 1, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          reply.outboundId,
          reply.sourceEventId,
          reply.policyId,
          reply.actor.roleId,
          reply.target.integrationId,
          reply.target.projectId,
          reply.target.conversationId,
          JSON.stringify(reply),
          Date.parse(reply.createdAt),
          JSON.stringify({ deliveredAt: "2026-09-17T00:00:10.500Z" }),
          Date.parse("2026-09-17T00:00:10.500Z"),
        );
      database
        .prepare(
          `INSERT INTO conversation_outbox (
            outbound_id, source_event_id, policy_id, role_id, integration_id, project_id,
            conversation_id, outbound_json, status, available_at_ms, attempt_count,
            lease_id, lease_owner, lease_expires_at_ms, last_failure_code, last_failed_at_ms,
            receipt_json, delivered_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`,
        )
        .run(
          pending.outboundId,
          pending.sourceEventId,
          pending.policyId,
          pending.actor.roleId,
          pending.target.integrationId,
          pending.target.projectId,
          pending.target.conversationId,
          JSON.stringify(pending),
          Date.parse(pending.createdAt),
        );
    } finally {
      database.close();
    }

    const history = new SQLiteConversationHistory(path, artifactStore);
    const turns = await history.recent(events.at(-1)!);
    const evidence = await history.recentEvidence(events.at(-1)!);

    expect(turns).toHaveLength(9);
    expect(turns[0]).toMatchObject({
      text: "이 설계는 네 플랫폼의 장점을 Lervo 코어에 통합한다.",
      speaker: { kind: "human", participantId: "ptc_human001" },
    });
    expect(turns.slice(1).every((turn) => turn.speaker.kind === "agent")).toBe(true);
    expect(turns.map((turn) => turn.text)).toContain("Fourth task: repair backup capacity safely.");
    expect(turns.map((turn) => turn.text)).not.toContain(
      "Do not treat this unsent reply as context.",
    );
    expect(turns.map((turn) => turn.text)).not.toContain("에이전트 상태 10");
    await expect(history.verifyEvidence(events.at(-1)!, evidence)).resolves.toBeUndefined();
    await expect(
      history.verifyEvidence(events.at(-1)!, [
        { ...evidence.find((turn) => turn.role === "assistant")!, text: "A different task" },
      ]),
    ).rejects.toThrow(/differs from its exact source/u);

    const { eventId: _eventId, ...boundarySource } = events[9]!;
    const sameInstant = createConversationInboundEvent({
      ...boundarySource,
      occurredAt: "2026-09-17T00:00:10Z",
    });
    const prior = await history.recentEvidence(sameInstant);
    expect(prior.map((turn) => turn.text)).not.toContain("에이전트 상태 9");
    await expect(
      history.verifyEvidence(sameInstant, [
        evidence.find((turn) => turn.text === "에이전트 상태 9")!,
      ]),
    ).rejects.toThrow(/not prior to ingress/u);
  });
});
