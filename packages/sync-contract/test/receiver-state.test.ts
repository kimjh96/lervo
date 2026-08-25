import { computeEventHash } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  assertEventSyncAcknowledgement,
  createOutboundEventBatch,
  planOutboundEventAcceptance,
  planProjectRegistration,
} from "../src/index.js";
import { eventChain, manifest, registration } from "./fixture.js";

describe("Hub event acceptance reference semantics", () => {
  it("buffers reversed batches, advances only a contiguous cursor, and deduplicates retries", () => {
    const project = manifest();
    const request = registration(project);
    const events = eventChain(project.projectId, 4);
    const registered = planProjectRegistration({
      current: null,
      request,
      acceptedAt: "2026-08-19T01:00:01.000Z",
    });
    const laterBatch = createOutboundEventBatch({ registration: request, events: events.slice(2) });
    const later = planOutboundEventAcceptance({
      state: registered.state,
      batch: laterBatch,
      acknowledgedAt: "2026-08-19T01:01:00.000Z",
    });
    expect(later.acknowledgement).toMatchObject({
      status: "accepted",
      cursor: { seq: 0, eventHash: null },
      bufferedEventCount: 2,
    });

    const duplicate = planOutboundEventAcceptance({
      state: later.state,
      batch: laterBatch,
      acknowledgedAt: "2026-08-19T01:01:01.000Z",
    });
    expect(duplicate.acknowledgement).toMatchObject({
      status: "duplicate",
      insertedCount: 0,
      duplicateCount: 2,
      cursor: { seq: 0 },
    });

    const earlierBatch = createOutboundEventBatch({
      registration: request,
      events: events.slice(0, 2),
    });
    const completed = planOutboundEventAcceptance({
      state: duplicate.state,
      batch: earlierBatch,
      acknowledgedAt: "2026-08-19T01:01:02.000Z",
    });
    expect(completed.acknowledgement).toMatchObject({
      status: "accepted",
      cursor: { seq: 4, eventHash: events[3]?.eventHash },
      bufferedEventCount: 0,
    });
    expect(completed.state.events.map((event) => event.seq)).toEqual([1, 2, 3, 4]);

    expect(() =>
      assertEventSyncAcknowledgement({
        batch: earlierBatch,
        acknowledgement: {
          ...completed.acknowledgement,
          acceptedEventIds: [events[0]!.eventId],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_acknowledgement" }));
  });

  it("keeps project streams isolated and rejects divergent chain coordinates", () => {
    const firstProject = manifest("prj_sync_project_01");
    const secondProject = manifest("prj_sync_project_02");
    const firstRegistration = registration(firstProject);
    const secondRegistration = registration(secondProject);
    const firstEvents = eventChain(firstProject.projectId, 1);
    const secondEvents = eventChain(secondProject.projectId, 1);
    const firstState = planProjectRegistration({
      current: null,
      request: firstRegistration,
      acceptedAt: "2026-08-19T01:00:01.000Z",
    }).state;

    expect(() =>
      planOutboundEventAcceptance({
        state: firstState,
        batch: createOutboundEventBatch({
          registration: secondRegistration,
          events: secondEvents,
        }),
        acknowledgedAt: "2026-08-19T01:01:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "registration_required" }));

    const accepted = planOutboundEventAcceptance({
      state: firstState,
      batch: createOutboundEventBatch({
        registration: firstRegistration,
        events: firstEvents,
      }),
      acknowledgedAt: "2026-08-19T01:01:01.000Z",
    });
    const { eventHash: _eventHash, ...originalWithoutHash } = firstEvents[0]!;
    const divergentWithoutHash: Omit<EventEnvelope, "eventHash"> = {
      ...originalWithoutHash,
      eventId: "evt_sync_divergent_01",
      payload: {
        requestDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        role: "developer",
        risk: "low",
      },
    };
    const divergent: EventEnvelope = {
      ...divergentWithoutHash,
      eventHash: computeEventHash(divergentWithoutHash),
    };
    expect(() =>
      planOutboundEventAcceptance({
        state: accepted.state,
        batch: createOutboundEventBatch({
          registration: firstRegistration,
          events: [divergent],
        }),
        acknowledgedAt: "2026-08-19T01:01:02.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "event_chain_conflict" }));
  });
});
