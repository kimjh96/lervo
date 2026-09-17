import { computeEventHash, type EventHashInput } from "@lervo/event-contract";
import { type EventEnvelope, validateSchema } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { activityCursorFromEventHash, projectActivityPage } from "../src/index.js";

const policyVersion = `sha256:${"a".repeat(64)}`;
const repositoryRevision = `sha256:${"b".repeat(64)}`;

function event(
  seq: number,
  type: EventEnvelope["type"],
  previousHash: string | null,
  actor: EventEnvelope["actor"] = { kind: "system" },
): EventEnvelope {
  const withoutHash = {
    eventId: `evt_activity_${String(seq).padStart(8, "0")}`,
    projectId: "prj_activity_projection",
    runId: "run_activity_projection",
    sessionId: "ses_activity_projection",
    seq,
    type,
    occurredAt: `2026-09-17T00:00:0${seq}.000Z`,
    actor,
    schemaVersion: 3,
    policyVersion,
    payload: { privateValue: `private-${seq}` },
    previousHash,
  } as EventHashInput;
  return { ...withoutHash, eventHash: computeEventHash(withoutHash) } as EventEnvelope;
}

function chain(): EventEnvelope[] {
  const first = event(1, "context.selected", null, { kind: "agent", provider: "codex" });
  const second = event(2, "file.changed", first.eventHash, {
    kind: "provider",
    provider: "codex",
  });
  return [first, second, event(3, "verification.completed", second.eventHash)];
}

describe("product activity projector", () => {
  it("projects a bounded page with deterministic replay cursors and no payload bodies", () => {
    const events = chain();
    const page = projectActivityPage({
      sourceEventHeadHash: events[2]!.eventHash,
      repositoryRevision,
      requestCursor: null,
      precedingEventHash: null,
      precedingSequence: 0,
      events,
      limit: 2,
    });

    expect(validateSchema("productActivityPage", page)).toEqual({ valid: true, errors: [] });
    expect(page).toMatchObject({
      status: "complete",
      returnedCursor: activityCursorFromEventHash(events[1]!.eventHash),
      nextCursor: activityCursorFromEventHash(events[1]!.eventHash),
      items: [
        { actionClass: "repository_read", actor: { kind: "agent" }, salience: "low" },
        { actionClass: "repository_edit", actor: { kind: "provider" } },
      ],
    });
    expect(JSON.stringify(page)).not.toContain("private-");
  });

  it("continues from the exact preceding event and closes the final page", () => {
    const events = chain();
    const page = projectActivityPage({
      sourceEventHeadHash: events[2]!.eventHash,
      repositoryRevision,
      requestCursor: activityCursorFromEventHash(events[1]!.eventHash),
      precedingEventHash: events[1]!.eventHash,
      precedingSequence: 2,
      events: [events[2]],
      limit: 2,
    });

    expect(page).toMatchObject({
      status: "complete",
      nextCursor: null,
      items: [{ actionClass: "verification", outcome: "succeeded", salience: "high" }],
    });
  });

  it("returns an empty valid page after the verified event head", () => {
    const events = chain();
    const cursor = activityCursorFromEventHash(events[2]!.eventHash);
    expect(
      projectActivityPage({
        sourceEventHeadHash: events[2]!.eventHash,
        repositoryRevision,
        requestCursor: cursor,
        precedingEventHash: events[2]!.eventHash,
        precedingSequence: 3,
        events: [],
        limit: 10,
      }),
    ).toMatchObject({ status: "empty", returnedCursor: cursor, nextCursor: null, items: [] });
  });

  it("fails a stale cursor without projecting any event", () => {
    const events = chain();
    expect(
      projectActivityPage({
        sourceEventHeadHash: events[2]!.eventHash,
        repositoryRevision,
        requestCursor: `pac_${"f".repeat(24)}`,
        precedingEventHash: events[0]!.eventHash,
        precedingSequence: 1,
        events: [events[1]],
        limit: 10,
      }),
    ).toMatchObject({ status: "failed", failureCode: "activity_cursor_stale", items: [] });
  });

  it("fails a broken hash chain and an unsupported future event schema distinctly", () => {
    const events = chain();
    const broken = { ...events[1], previousHash: `sha256:${"f".repeat(64)}` };
    expect(
      projectActivityPage({
        sourceEventHeadHash: events[1]!.eventHash,
        repositoryRevision,
        requestCursor: activityCursorFromEventHash(events[0]!.eventHash),
        precedingEventHash: events[0]!.eventHash,
        precedingSequence: 1,
        events: [broken],
        limit: 10,
      }),
    ).toMatchObject({ status: "failed", failureCode: "activity_evidence_invalid" });

    expect(
      projectActivityPage({
        sourceEventHeadHash: events[0]!.eventHash,
        repositoryRevision,
        requestCursor: null,
        precedingEventHash: null,
        precedingSequence: 0,
        events: [{ ...events[0], schemaVersion: 4 }],
        limit: 10,
      }),
    ).toMatchObject({ status: "failed", failureCode: "activity_schema_unsupported" });
  });

  it("rejects unbounded windows before projection", () => {
    const events = chain();
    expect(() =>
      projectActivityPage({
        sourceEventHeadHash: events[2]!.eventHash,
        repositoryRevision,
        requestCursor: null,
        precedingEventHash: null,
        precedingSequence: 0,
        events,
        limit: 1,
      }),
    ).toThrowError("limit plus one");
  });
});
