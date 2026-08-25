import { computeEventHash } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { assertOutboundEventBatch, createOutboundEventBatch } from "../src/index.js";
import { eventChain, manifest, registration } from "./fixture.js";

describe("outbound event batch contract", () => {
  it("binds an allowlisted contiguous chain to one deterministic batch", () => {
    const project = manifest();
    const request = registration(project);
    const events = eventChain(project.projectId, 3);
    const batch = createOutboundEventBatch({ registration: request, events: events.slice(0, 2) });
    const retry = createOutboundEventBatch({ registration: request, events: events.slice(0, 2) });

    expect(retry).toEqual(batch);
    expect(batch).toMatchObject({
      firstSeq: 1,
      lastSeq: 2,
      previousHash: null,
      headHash: events[1]?.eventHash,
    });
    expect(() =>
      assertOutboundEventBatch({
        ...batch,
        headHash: events[0]!.eventHash,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_event_batch" }));
    expect(() =>
      createOutboundEventBatch({
        registration: request,
        events: [events[0]!, events[2]!],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_event_batch" }));
  });

  it("rejects a hash-valid event that contains payload outside the Hub allowlist", () => {
    const project = manifest();
    const request = registration(project);
    const source = eventChain(project.projectId, 1)[0]!;
    const { eventHash: _eventHash, ...sourceWithoutHash } = source;
    const withoutHash: Omit<EventEnvelope, "eventHash"> = {
      ...sourceWithoutHash,
      payload: { ...source.payload, rawPrompt: "must not sync" },
    };
    const unsafe: EventEnvelope = {
      ...withoutHash,
      eventHash: computeEventHash(withoutHash),
    };

    expect(() =>
      createOutboundEventBatch({
        registration: request,
        events: [unsafe],
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_event_batch" }));
  });

  it("keeps a hash-valid legacy recommendation event syncable without rewriting its payload", () => {
    const project = manifest();
    const request = registration(project);
    const source = eventChain(project.projectId, 1)[0]!;
    const { eventHash: _eventHash, ...sourceWithoutHash } = source;
    const withoutHash: Omit<EventEnvelope, "eventHash"> = {
      ...sourceWithoutHash,
      type: "context.recommended",
      payload: {
        recommendationId: `srec_${"a".repeat(24)}`,
        batchId: `srb_${"b".repeat(24)}`,
        sourceAttemptId: `sat_${"c".repeat(24)}`,
        engineId: "lexical",
        engineVersion: 1,
        indexId: `sidx_${"d".repeat(24)}`,
        resultSetHash: `sha256:${"e".repeat(64)}`,
        documentId: "doc_sync_context_01",
        sourceContentHash: `sha256:${"f".repeat(64)}`,
        rank: 1,
        score: 12,
        selectionPolicyId: "top_ranked",
        selectionPolicyVersion: 1,
        selectionMaximum: 3,
      },
    };
    const legacy: EventEnvelope = { ...withoutHash, eventHash: computeEventHash(withoutHash) };

    const batch = createOutboundEventBatch({ registration: request, events: [legacy] });
    expect(batch.events[0]!.payload).not.toHaveProperty("selectionTransitionId");
  });
});
