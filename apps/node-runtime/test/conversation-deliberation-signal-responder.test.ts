import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  createConversationParticipationDecision,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationResponder } from "@lervo/interaction";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationDeliberationSignalResponder } from "../src/conversation-deliberation-signal-responder.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("conversation deliberation signal responder", () => {
  it("publishes owned status text without invoking the provider-backed delegate", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const content = await artifactStore.put(
      "Deliberation round 1: architect published a writing-gated proposal. Claims: 2.",
    );
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey("deliberation-artifact-signal"),
      target: {
        integrationId: "itg_discord01",
        projectId: "prj_node_runtime_01",
        conversationId: "cnv_discord_origin01",
        threadId: "thd_discord_origin01",
      },
      kind: "signal.raised",
      actor: {
        kind: "system",
        participantId: "ptc_lervo_system",
        roleId: null,
        agentBinding: null,
      },
      content: {
        artifactId: `art_${content.contentHash.slice("sha256:".length, 60)}`,
        contentHash: content.contentHash,
        byteCount: content.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      mentions: { roleIds: [], participantIds: [] },
      replyToEventId: `cve_${"e".repeat(64)}`,
      signalCode: "deliberation.artifact.recorded",
      automationDepth: 0,
      occurredAt: "2026-09-17T00:00:01.000Z",
    });
    const policy = createConversationParticipationPolicy({
      projectId: "prj_node_runtime_01",
      roleId: "developer",
      conversationIds: ["cnv_discord_origin01"],
      mode: "proactive",
      respondTo: ["system"],
      signalCodes: ["deliberation.artifact.recorded"],
      cooldownSeconds: 0,
      maxResponsesPerHour: 20,
      maxAutomationDepth: 2,
      createdAt: "2026-09-17T00:00:00.000Z",
    });
    const decision = createConversationParticipationDecision({
      event,
      policy,
      action: "respond",
      reason: "proactive_signal",
      relevance: "not_checked",
      decidedAt: "2026-09-17T00:00:02.000Z",
    });
    const delegate = {
      respond: vi.fn<ConversationResponder["respond"]>(),
    };
    const responder = new ConversationDeliberationSignalResponder({
      artifactStore,
      delegate,
      now: () => new Date("2026-09-17T00:00:03.000Z"),
    });

    const result = await responder.respond({ event, policy, decision });
    expect(delegate.respond).not.toHaveBeenCalled();
    expect(result.publicationPermit.surface).toBe("chat");
    expect(result.publicationPermit.contentHash).toBe(result.content.contentHash);
    expect(result.deliveryRelation).toBe("reply");
    expect(result.audienceParticipation).toBe("observe_only");
    const body = Buffer.from(
      await artifactStore.get(
        `lervo-cas://sha256/${result.content.contentHash.slice("sha256:".length)}`,
      ),
    ).toString("utf8");
    expect(body).toContain("writing-gated proposal");
  });
});
