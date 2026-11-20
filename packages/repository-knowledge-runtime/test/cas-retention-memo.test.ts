import type { EventEnvelope } from "@lervo/schemas";
import type { ListEventsOptions, OutboxStore } from "@lervo/storage-contract";
import { expect, it } from "vitest";

import {
  memoizedConvergenceArtifactRoots,
  RETENTION_ROOTS_FULL_REPLAY_MILLISECONDS,
  retentionStillIdle,
} from "../src/cas-retention-memo.js";
import { convergenceArtifactRoots } from "../src/cas-retention-policy.js";
import {
  RETENTION_IDLE_RECHECK_MILLISECONDS,
  type RetentionScan,
} from "../src/cas-retention-state.js";

const digest = (value: number) => value.toString(16).padStart(64, "0");
const T0 = Date.parse("2026-11-20T00:00:00.000Z");

/** A chained log that grows in place and counts every replay from its first event. */
function growingLog() {
  const rows: { type: string; payload: Record<string, unknown> }[] = [];
  const at = (seq: number) =>
    ({
      eventId: `evt_${String(seq).padStart(24, "0")}`,
      projectId: "prj_casretention",
      runId: "run_casretention",
      sessionId: "ses_casretention",
      seq,
      type: rows[seq - 1]!.type,
      occurredAt: "2026-11-01T00:00:00.000Z",
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: `sha256:${"a".repeat(64)}`,
      payload: rows[seq - 1]!.payload,
      previousHash: seq === 1 ? null : `sha256:${digest(seq - 1)}`,
      eventHash: `sha256:${digest(seq)}`,
    }) as EventEnvelope;
  const counts = { replays: 0 };
  const store = {
    latest: () => (rows.length === 0 ? null : at(rows.length)),
    list: ({ afterSeq = 0, limit = 100, types }: ListEventsOptions = {}) => {
      if (types !== undefined) return [];
      if (afterSeq === 0) counts.replays++;
      return Array.from({ length: Math.max(0, Math.min(limit, rows.length - afterSeq)) }, (_, i) =>
        at(afterSeq + i + 1),
      );
    },
  } as unknown as OutboxStore;
  return {
    store,
    counts,
    append(type: string, payload: Record<string, unknown> = {}) {
      rows.push({ type, payload });
    },
  };
}

function rootsOf(store: OutboxStore) {
  const { head, headSeq, reachable, lastReference } = convergenceArtifactRoots(store);
  return { head, headSeq, reachable, lastReference };
}

it("extends the last replay by events outside any artifact lifecycle, exactly as a replay roots them (ADR-0601)", () => {
  const log = growingLog();
  log.append("context.selected");
  log.append("context.selected", { ref: `sha256:${digest(0xa)}` });
  const first = memoizedConvergenceArtifactRoots(log.store, T0);
  expect(log.counts.replays).toBe(1);
  // An unchanged head reuses the roots without reading the log.
  expect(memoizedConvergenceArtifactRoots(log.store, T0 + 1)).toBe(first);
  expect(log.counts.replays).toBe(1);
  // Terminal and context events only root what they name.
  log.append("terminal.turn.observed", { artifact: `lervo-cas://sha256/${digest(0xb)}` });
  log.append("context.selected", { ref: `sha256:${digest(0xa)}` });
  const extended = memoizedConvergenceArtifactRoots(log.store, T0 + 2);
  expect(log.counts.replays).toBe(1);
  const replayed = rootsOf(log.store);
  expect({
    head: extended.head,
    headSeq: extended.headSeq,
    reachable: extended.reachable,
    lastReference: extended.lastReference,
  }).toEqual(replayed);
  expect(extended.reachable).toEqual(new Set([digest(0xa), digest(0xb)]));
  expect(extended.lastReference.get(digest(0xa))).toBe(4);
  // The extension never changes the roots an earlier pass was given.
  expect(first.reachable).toEqual(new Set([digest(0xa)]));
});

it("replays the whole log for a lifecycle event, a long gap, or after six hours (ADR-0601)", () => {
  const log = growingLog();
  log.append("context.selected");
  memoizedConvergenceArtifactRoots(log.store, T0);
  expect(log.counts.replays).toBe(1);
  log.append("assignment.started", { assignmentId: "asg_000000000000000000000001" });
  memoizedConvergenceArtifactRoots(log.store, T0 + 1);
  expect(log.counts.replays).toBe(2);
  log.append("execution.stages.observed", { assignmentId: "asg_000000000000000000000001" });
  memoizedConvergenceArtifactRoots(log.store, T0 + 2);
  expect(log.counts.replays).toBe(3);
  for (let index = 0; index < 1_001; index++) log.append("terminal.turn.observed");
  memoizedConvergenceArtifactRoots(log.store, T0 + 3);
  expect(log.counts.replays).toBe(4);
  log.append("terminal.turn.observed");
  memoizedConvergenceArtifactRoots(log.store, T0 + RETENTION_ROOTS_FULL_REPLAY_MILLISECONDS + 3);
  expect(log.counts.replays).toBe(5);
});

function idleScan(seq: number | undefined): RetentionScan {
  return {
    schemaVersion: 1,
    nextScanAt: 0,
    eligible: [],
    files: {},
    reports: {},
    idle: {
      head: `sha256:${digest(1)}`,
      at: T0,
      ...(seq === undefined ? {} : { seq }),
    },
  };
}

it("keeps an idle answer through events outside any artifact lifecycle (ADR-0601)", () => {
  const log = growingLog();
  log.append("context.selected");
  const scan = idleScan(1);
  expect(retentionStillIdle(scan, log.store, T0 + 1)).toBe(true);
  log.append("terminal.turn.observed", { ref: `sha256:${digest(0xc)}` });
  log.append("execution.stages.observed");
  expect(retentionStillIdle(scan, log.store, T0 + 2)).toBe(true);
  // A second check resumes after the events already checked.
  expect(retentionStillIdle(scan, log.store, T0 + 3)).toBe(true);
  log.append("repository.knowledge.stage.recorded");
  expect(retentionStillIdle(scan, log.store, T0 + 4)).toBe(false);
  // The grace horizon still moves with time.
  expect(retentionStillIdle(scan, log.store, T0 + RETENTION_IDLE_RECHECK_MILLISECONDS)).toBe(false);
});

it("ends an idle answer without a recorded sequence once the head moves", () => {
  const log = growingLog();
  log.append("context.selected");
  const scan = idleScan(undefined);
  expect(retentionStillIdle(scan, log.store, T0 + 1)).toBe(true);
  log.append("terminal.turn.observed");
  expect(retentionStillIdle(scan, log.store, T0 + 2)).toBe(false);
  const { idle: _idle, ...withoutIdle } = scan;
  expect(retentionStillIdle(withoutIdle, log.store, T0 + 2)).toBe(false);
});
