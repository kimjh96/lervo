import { computeEventHash } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  assertOutboundEventBatch,
  assertSyncableEvent,
  createOutboundEventBatch,
} from "../src/index.js";
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

  it("accepts mixed v1/v2 and v6 events and rejects unsupported versions distinctly", () => {
    const project = manifest();
    const events = eventChain(project.projectId, 2, (seq) =>
      seq === 1
        ? {}
        : {
            schemaVersion: 2,
            type: "work.causality.recorded",
            payload: {
              workId: `wrk_${"a".repeat(24)}`,
              executionContractVersion: 1,
              relationship: "root",
              parentRunId: null,
              retryOfRunId: null,
              attemptOrdinal: 1,
              workstreamId: null,
              assignmentId: null,
              agentId: null,
            },
          },
    );
    const batch = createOutboundEventBatch({ registration: registration(project), events });
    expect(batch.events.map((event) => event.schemaVersion)).toEqual([1, 2]);
    const { eventHash: _eventHash, ...source } = events[0]!;
    const current = { ...source, schemaVersion: 6 as const };
    const version6 = { ...current, eventHash: computeEventHash(current) };
    expect(
      createOutboundEventBatch({ registration: registration(project), events: [version6] }).events,
    ).toEqual([version6]);
    expect(() =>
      assertSyncableEvent({ ...events[1]!, schemaVersion: 10 } as unknown as EventEnvelope),
    ).toThrowError(expect.objectContaining({ code: "event_schema_unsupported" }));
    expect(() =>
      assertOutboundEventBatch({
        ...batch,
        events: [events[0]!, { ...events[1]!, schemaVersion: 10 } as unknown as EventEnvelope],
      }),
    ).toThrowError(expect.objectContaining({ code: "event_schema_unsupported" }));
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

  it.each([
    {
      type: "adapter.result.captured",
      payload: {
        adapterId: "codex-app-server",
        providerSessionId: "session-legacy",
        targetTurnId: "turn-legacy",
        providerTurnId: "provider-turn-legacy",
        resultDigest: `sha256:${"a".repeat(64)}`,
        byteCount: 1,
        mediaType: "text/markdown; charset=utf-8",
        referenceTelemetry: "supported",
      },
    },
    {
      type: "resource.usage.recorded",
      payload: {
        workId: `wrk_${"a".repeat(24)}`,
        resourceObservationId: `ruo_${"b".repeat(24)}`,
        sourceCoordinateDigest: `sha256:${"c".repeat(64)}`,
        scope: "primary_provider",
        source: "provider_reported",
        accountingMode: "operation_delta",
        accountingDescriptorHash: `sha256:${"d".repeat(64)}`,
        status: "unavailable",
        usage: null,
        reasonCode: "legacy_unobserved",
      },
    },
  ] as const)(
    "keeps a hash-valid legacy $type event syncable without inventing model evidence",
    ({ type, payload }) => {
      const project = manifest();
      const source = eventChain(project.projectId, 1)[0]!;
      const { eventHash: _eventHash, ...sourceWithoutHash } = source;
      // Both recorded versions of a captured result predate provider-observed model identity;
      // recorded usage only exists from version 2.
      const versions = type === "adapter.result.captured" ? ([1, 2] as const) : ([2] as const);
      for (const schemaVersion of versions) {
        const withoutHash: Omit<EventEnvelope, "eventHash"> = {
          ...sourceWithoutHash,
          schemaVersion,
          type,
          actor: { kind: "provider", provider: "codex" },
          payload,
        };
        const legacy: EventEnvelope = { ...withoutHash, eventHash: computeEventHash(withoutHash) };

        const batch = createOutboundEventBatch({
          registration: registration(project),
          events: [legacy],
        });
        expect(batch.events[0]!.payload).toEqual(payload);
        expect(batch.events[0]!.payload).not.toHaveProperty("modelIdentity");
      }
    },
  );
});
