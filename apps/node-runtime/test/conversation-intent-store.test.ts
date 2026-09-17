import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { ConversationInboundEvent } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { SQLiteConversationIntentResolutionStore } from "../src/conversation-intent-store.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

describe("conversation intent resolution evidence", () => {
  it("records provider and model immutably without raw message text", async () => {
    const root = await temporaryRoot();
    const path = resolve(root, "intent.sqlite");
    const store = await SQLiteConversationIntentResolutionStore.open(path);
    const event = {
      eventId: "cve_test0001",
      content: { contentHash: `sha256:${"a".repeat(64)}`, byteCount: 12 },
    } as ConversationInboundEvent;
    const input = {
      event,
      resolution: {
        intent: "answer" as const,
        confidence: "high" as const,
        participation: "not_relevant" as const,
        effect: { kind: "none" as const },
        executionProfile: null,
        provider: {
          providerId: "claude",
          requestedModel: "claude-sonnet",
          model: "claude-sonnet-4-6",
          observedModelIds: ["claude-haiku-4-5", "claude-sonnet-4-6"],
          answerModelEvidence: "assistant_message" as const,
          modelUnavailableReason: null,
          adapterVersion: "4" as const,
        },
        resultDigest: `sha256:${"b".repeat(64)}`,
      },
      resolvedAt: "2026-09-08T00:00:00.000Z",
    };
    await store.record(input);
    await store.record(input);
    await expect(store.read(event)).resolves.toEqual(input.resolution);
    const hireEvent = {
      eventId: "cve_hire0001",
      content: { contentHash: `sha256:${"d".repeat(64)}`, byteCount: 16 },
    } as ConversationInboundEvent;
    const hireResolution = {
      ...input.resolution,
      intent: "continue_work" as const,
      participation: "relevant" as const,
      effect: {
        kind: "workforce_agent_hire" as const,
        specification: '{"name":"Navi","roleId":"developer","provider":"any"}',
      },
      executionProfile: null,
      resultDigest: `sha256:${"e".repeat(64)}`,
    };
    await store.record({ ...input, event: hireEvent, resolution: hireResolution });
    await expect(store.read(hireEvent)).resolves.toEqual(hireResolution);
    const specificationEffects = [
      {
        eventId: "cve_delegate0001",
        effect: {
          kind: "workforce_task_delegate" as const,
          specification: "Assign an architecture review with repository verification.",
        },
        resultDigest: `sha256:${"f".repeat(64)}`,
      },
      {
        eventId: "cve_deliberation0001",
        effect: {
          kind: "deliberation_start" as const,
          specification: "Review the Discord-first platform architecture and decide go or no-go.",
        },
        resultDigest: `sha256:${"1".repeat(64)}`,
      },
    ];
    for (const specificationEffect of specificationEffects) {
      const specificationEvent = {
        eventId: specificationEffect.eventId,
        content: { contentHash: `sha256:${"2".repeat(64)}`, byteCount: 32 },
      } as ConversationInboundEvent;
      const specificationResolution = {
        ...input.resolution,
        intent: "continue_work" as const,
        participation: "relevant" as const,
        effect: specificationEffect.effect,
        resultDigest: specificationEffect.resultDigest,
      };
      await store.record({
        ...input,
        event: specificationEvent,
        resolution: specificationResolution,
      });
      await expect(store.read(specificationEvent)).resolves.toEqual(specificationResolution);
    }
    await expect(
      store.read({
        ...event,
        content: { ...event.content, contentHash: `sha256:${"c".repeat(64)}` },
      }),
    ).rejects.toThrow("stored conversation intent resolution is invalid");
    store.close();

    const database = new DatabaseSync(path, { readOnly: true });
    const row = database.prepare("SELECT * FROM conversation_intent_resolutions").get();
    database.close();
    expect(row).toMatchObject({
      event_id: event.eventId,
      provider_id: "claude",
      model: "claude-sonnet-4-6",
      requested_model: "claude-sonnet",
      observed_model_ids_json: '["claude-haiku-4-5","claude-sonnet-4-6"]',
      answer_model_evidence: "assistant_message",
      intent: "answer",
      participation: "not_relevant",
    });
    expect(JSON.stringify(row)).not.toContain("message text");
    await removeTemporaryRoots();
  });
});
