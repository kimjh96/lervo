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
        provider: {
          providerId: "claude",
          model: "claude-sonnet-4-6",
          adapterVersion: "1" as const,
        },
        resultDigest: `sha256:${"b".repeat(64)}`,
      },
      resolvedAt: "2026-09-08T00:00:00.000Z",
    };
    await store.record(input);
    await store.record(input);
    await expect(store.read(event)).resolves.toEqual(input.resolution);
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
      intent: "answer",
    });
    expect(JSON.stringify(row)).not.toContain("message text");
    await removeTemporaryRoots();
  });
});
