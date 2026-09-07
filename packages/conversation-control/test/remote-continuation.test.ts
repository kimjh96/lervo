import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  createConversationParticipationDecision,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { defaultEnglishWritingContract } from "@lervo/core";
import type { WritingSemanticEvaluator } from "@lervo/writing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationRemoteContinuationResponder } from "../src/index.js";

const roots: string[] = [];
const now = new Date("2026-09-07T08:15:00.000Z");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function evaluator(): WritingSemanticEvaluator {
  return {
    async evaluate(request) {
      return {
        evaluator: { kind: "model", evaluatorId: "fixture.remote-continuation-writing.v1" },
        checks: request.checks.map((check) => ({
          checkId: check.checkId,
          status: "passed" as const,
          violationCount: 0,
        })),
      };
    },
  };
}

async function fixture(actorKind: "human" | "agent" = "human") {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-remote-continuation-"));
  roots.push(root);
  const artifacts = await FileSystemCas.open(root);
  const request = "Continue the current assignment and verify the Discord gateway changes.";
  const stored = await artifacts.put(request);
  const event = createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey("discord/message/continuation-1"),
    target: {
      integrationId: "itg_discord01",
      projectId: "prj_remote001",
      conversationId: "cnv_remote001",
      threadId: "thd_remote001",
    },
    kind: "message.created",
    actor:
      actorKind === "human"
        ? { kind: "human", participantId: "ptc_operator01", roleId: null }
        : { kind: "agent", participantId: "ptc_agent001", roleId: "developer" },
    content: {
      artifactId: `art_${stored.contentHash.slice("sha256:".length)}`,
      contentHash: stored.contentHash,
      byteCount: stored.byteCount,
      mediaType: "text/plain; charset=utf-8",
    },
    mentions: { roleIds: ["developer"], participantIds: [] },
    replyToEventId: null,
    signalCode: null,
    automationDepth: 0,
    occurredAt: "2026-09-07T08:14:00.000Z",
  });
  const policy = createConversationParticipationPolicy({
    projectId: "prj_remote001",
    roleId: "developer",
    conversationIds: ["cnv_remote001"],
    mode: "mention_only",
    respondTo: ["human"],
    signalCodes: [],
    cooldownSeconds: 0,
    maxResponsesPerHour: 8,
    maxAutomationDepth: 2,
    createdAt: "2026-09-07T08:00:00.000Z",
  });
  const decision = createConversationParticipationDecision({
    event,
    policy,
    action: "respond",
    reason: "mentioned",
    relevance: "not_checked",
    decidedAt: now.toISOString(),
  });
  return { artifacts, request, event, policy, decision };
}

describe("conversation remote continuation responder", () => {
  it("queues exact human message evidence and returns a publication-verified receipt message", async () => {
    const { artifacts, request, event, policy, decision } = await fixture();
    const submit = vi.fn(async () => ({
      status: "queued" as const,
      deliveryId: `rcd_${"a".repeat(64)}`,
      provider: "codex",
      roleId: "developer",
      workstreamId: `wks_${"b".repeat(24)}`,
      workstreamRevision: 12,
    }));
    const responder = new ConversationRemoteContinuationResponder({
      artifactStore: artifacts,
      continuation: { request: submit },
      writingContract: defaultEnglishWritingContract,
      semanticEvaluator: evaluator(),
      now: () => now,
    });

    const candidate = await responder.respond({ event, policy, decision });

    expect(submit).toHaveBeenCalledWith({
      projectId: event.target.projectId,
      conversationId: event.target.conversationId,
      threadId: event.target.threadId,
      eventId: event.eventId,
      participantId: event.actor.participantId,
      request,
      requestContentHash: event.content.contentHash,
      requestedAt: now.toISOString(),
    });
    expect(candidate.publicationPermit.surface).toBe("chat");
    const reply = Buffer.from(
      await artifacts.get(
        `lervo-cas://sha256/${candidate.content.contentHash.slice("sha256:".length)}`,
      ),
    ).toString("utf8");
    expect(reply).toContain(`rcd_${"a".repeat(64)}`);
    expect(reply).toContain("queueing only");
    expect(reply).not.toContain(request);
  });

  it("rejects an agent-authored message before crossing the remote execution port", async () => {
    const { artifacts, event, policy, decision } = await fixture("agent");
    const submit = vi.fn();
    const responder = new ConversationRemoteContinuationResponder({
      artifactStore: artifacts,
      continuation: { request: submit },
      writingContract: defaultEnglishWritingContract,
      semanticEvaluator: evaluator(),
      now: () => now,
    });

    await expect(responder.respond({ event, policy, decision })).rejects.toMatchObject({
      code: "remote_continuation_denied",
    });
    expect(submit).not.toHaveBeenCalled();
  });
});
