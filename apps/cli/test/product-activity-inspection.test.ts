import { computeEventHash, type EventHashInput } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { inspectProductActivity } from "../src/product-activity-inspection.js";

const policyVersion = `sha256:${"a".repeat(64)}`;
const repositoryRevision = `sha256:${"b".repeat(64)}`;

function event(seq: number, previousHash: string | null): EventEnvelope {
  const value = {
    eventId: `evt_activity_query_${String(seq).padStart(8, "0")}`,
    projectId: "prj_activity_query",
    runId: "run_activity_query",
    sessionId: "ses_activity_query",
    seq,
    type: seq === 1 ? "context.selected" : "verification.completed",
    occurredAt: `2026-09-17T00:00:0${seq}.000Z`,
    actor: { kind: "system" },
    schemaVersion: 3,
    policyVersion,
    payload: {},
    previousHash,
  } as EventHashInput;
  return { ...value, eventHash: computeEventHash(value) } as EventEnvelope;
}

function fixture() {
  const first = event(1, null);
  const events = [first, event(2, first.eventHash)];
  let closeCount = 0;
  const dependencies = {
    openStorage: async () => ({
      events: {
        verifyIntegrity: () => ({
          valid: true as const,
          eventCount: events.length,
          headHash: events.at(-1)!.eventHash,
        }),
        list: ({ afterSeq = 0, limit = 100 } = {}) =>
          events.filter((item) => item.seq > afterSeq).slice(0, limit),
      },
      close: async () => {
        closeCount += 1;
      },
    }),
    captureSnapshot: async () => ({ revision: repositoryRevision }),
  };
  return { dependencies, events, closeCount: () => closeCount };
}

describe("product activity inspection", () => {
  it("binds canonical storage and repository coordinates to a bounded page", async () => {
    const data = fixture();

    const page = await inspectProductActivity(
      { repositoryRoot: "/repository", cursor: null, limit: 1 },
      data.dependencies,
    );

    expect(page).toMatchObject({
      sourceEventHeadHash: data.events[1]!.eventHash,
      repositoryRevision,
      status: "complete",
      limit: 1,
      items: [{ actionClass: "repository_read" }],
    });
    expect(page.nextCursor).toBe(page.returnedCursor);
    expect(data.closeCount()).toBe(1);
  });

  it("returns an evidence-free failure for a cursor absent from the verified chain", async () => {
    const data = fixture();

    const page = await inspectProductActivity(
      { repositoryRoot: "/repository", cursor: `pac_${"f".repeat(24)}`, limit: 25 },
      data.dependencies,
    );

    expect(page).toMatchObject({
      status: "failed",
      failureCode: "activity_cursor_stale",
      items: [],
    });
    expect(data.closeCount()).toBe(1);
  });

  it("closes storage when no canonical event head exists", async () => {
    let closed = false;
    await expect(
      inspectProductActivity(
        { repositoryRoot: "/repository", cursor: null, limit: 25 },
        {
          openStorage: async () => ({
            events: {
              verifyIntegrity: () => ({ valid: true, eventCount: 0, headHash: null }),
              list: () => [],
            },
            close: async () => {
              closed = true;
            },
          }),
          captureSnapshot: async () => ({ revision: repositoryRevision }),
        },
      ),
    ).rejects.toThrowError("No canonical events");
    expect(closed).toBe(true);
  });
});
