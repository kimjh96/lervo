import { createHash } from "node:crypto";

import type { ConversationApplication } from "@lervo/conversation-app";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationDeliberationPort } from "@lervo/conversation-control";
import type { ArtifactStore } from "@lervo/storage-contract";
import { describe, expect, it, vi } from "vitest";

import { DiscordConversationDeliberationRuntime } from "../src/discord-conversation-deliberation-runtime.js";

function artifacts(): ArtifactStore {
  const values = new Map<string, Uint8Array>();
  const put: ArtifactStore["put"] = async (content) => {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const uri = `lervo-cas://sha256/${contentHash.slice(7)}`;
    values.set(uri, bytes);
    return { uri, contentHash, byteCount: bytes.byteLength, created: true };
  };
  return {
    put,
    putStream: async (chunks) => {
      const collected: Uint8Array[] = [];
      for await (const chunk of chunks) {
        collected.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      }
      return put(Buffer.concat(collected));
    },
    get: async (uri) => values.get(uri)!,
    has: async (uri) => values.has(uri),
  };
}

describe("Discord conversation deliberation runtime", () => {
  it("starts the configured policy from a natural-language surface effect", async () => {
    const artifactStore = artifacts();
    const start = vi.fn<ConversationDeliberationPort["start"]>(async () => ({
      deliberationId: "dlb_natural0001",
      status: "running",
      artifactCount: 0,
      nextAction: "wait",
    }));
    const runtime = await DiscordConversationDeliberationRuntime.open({
      config: {
        cliExecutable: process.execPath,
        workerId: "test-worker",
        defaultPolicyId: "deliberation_architecture-review",
        principals: [],
      },
      integrationId: "itg_discord01",
      projectId: "prj_control01",
      repositoryRoot: process.cwd(),
      artifactStore,
      onFailure: vi.fn(),
    });
    const deliberations: ConversationDeliberationPort = {
      start,
      resume: vi.fn(),
      inspect: vi.fn(),
    };
    const application = {
      deliberations,
      runDeliberationWorkerCycle: async () => ({ status: "idle" as const }),
      runDeliberationResumeWorkerCycle: async () => ({ status: "idle" as const }),
    } as unknown as ConversationApplication;
    runtime.attach(application, 1_000);
    const topic = "Review the repository knowledge conflict strategy.";
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey("natural-deliberation"),
      target: {
        integrationId: "itg_discord01",
        projectId: "prj_control01",
        conversationId: "cnv_operator01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_operator01", roleId: null },
      mentions: { participantIds: [], roleIds: [] },
      content: {
        artifactId: "art_natural0001",
        contentHash: `sha256:${"a".repeat(64)}`,
        byteCount: 1,
        mediaType: "text/plain; charset=utf-8",
      },
      replyToEventId: null,
      signalCode: null,
      automationDepth: 0,
      occurredAt: "2026-09-16T00:00:00.000Z",
    });

    await runtime.actionResponder.respond(
      { event } as never,
      { kind: "deliberation_start", specification: topic },
      { effectRequesterAuthorized: true },
    );

    expect(runtime.naturalLanguageEffect?.effectId).toBe("deliberation_start");
    expect(start).toHaveBeenCalledWith({
      event,
      policyId: "deliberation_architecture-review",
      topic,
      requestedAt: expect.any(String),
    });
    await runtime.stop();
  });
});
