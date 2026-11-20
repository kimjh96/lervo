import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { nextUtcDayAt, observePracticeSchedule } from "../src/practice-schedule.js";
import { PRACTICE_ROOT } from "../src/practice-store.js";

const MINUTE = 60_000;
const T = Date.parse("2026-11-19T01:00:00.000Z");
let root: string;
let revision = 0;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-practice-schedule-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function state(value: Record<string, unknown>) {
  await mkdir(resolve(root, PRACTICE_ROOT), { recursive: true });
  // A growing pad changes the size, so the schedule never reuses a parse across rewrites.
  revision += 1;
  await writeFile(
    resolve(root, PRACTICE_ROOT, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      works: [],
      evidence: [],
      candidates: [],
      generated: [],
      shapes: [],
      assessed: [],
      funnel: [],
      pad: "x".repeat(revision),
      ...value,
    }),
  );
}

const work = (digest: string, observedAt: number, resumeAt?: number) => ({
  workDigest: digest,
  observedAt: new Date(observedAt).toISOString(),
  ...(resumeAt === undefined ? {} : { resumeAt: new Date(resumeAt).toISOString() }),
});

it("has nothing due and no wake time without practice state", () => {
  const empty = observePracticeSchedule(root, T);
  expect(empty.nextDueAt).toBeNull();
  // No 30-minute clock window: an hour later the practice part of the fence is unchanged.
  expect(observePracticeSchedule(root, T + 60 * MINUTE)).toEqual(empty);
});

it("wakes when a work record's quiet period ends and changes the fence once", async () => {
  await state({ works: [work("w1", T)] });
  const before = observePracticeSchedule(root, T + MINUTE);
  expect(before.nextDueAt).toBe(T + 30 * MINUTE);
  expect(observePracticeSchedule(root, T + 29 * MINUTE).dueDigest).toBe(before.dueDigest);
  const due = observePracticeSchedule(root, T + 30 * MINUTE);
  expect(due.dueDigest).not.toBe(before.dueDigest);
  expect(due.nextDueAt).toBeNull();
  // Still due an hour later, but not newly due, so the fence stays unchanged.
  expect(observePracticeSchedule(root, T + 90 * MINUTE).dueDigest).toBe(due.dueDigest);
  // Once assessed, the work record is no longer scheduled.
  await state({
    works: [work("w1", T)],
    assessed: [{ workDigest: "w1", at: new Date(T + 31 * MINUTE).toISOString() }],
  });
  expect(observePracticeSchedule(root, T + 90 * MINUTE).dueDigest).toBe(before.dueDigest);
});

it("changes the fence when a resume time passes without setting the timer for it", async () => {
  await state({
    works: [work("w1", T, T + 120 * MINUTE)],
    candidates: [
      {
        candidateId: "c1",
        state: "drafted",
        observedAt: new Date(T).toISOString(),
        resumeAt: new Date(T + 45 * MINUTE).toISOString(),
        commit: "abc",
      },
      { candidateId: "c2", state: "published", observedAt: new Date(T).toISOString() },
    ],
  });
  // Admission waits resume a minute later while the owner works; the timer ignores them.
  expect(observePracticeSchedule(root, T + 31 * MINUTE).nextDueAt).toBeNull();
  const before = observePracticeSchedule(root, T + 44 * MINUTE).dueDigest;
  const resumed = observePracticeSchedule(root, T + 46 * MINUTE).dueDigest;
  expect(resumed).not.toBe(before);
  expect(observePracticeSchedule(root, T + 119 * MINUTE).dueDigest).toBe(resumed);
  expect(observePracticeSchedule(root, T + 121 * MINUTE).dueDigest).not.toBe(resumed);
});

it("wakes daily for usage of generated skills and expires unresolved candidates", async () => {
  await state({
    candidates: [
      {
        candidateId: "c1",
        state: "unresolved",
        observedAt: new Date(T).toISOString(),
        commit: null,
      },
    ],
    generated: [{ candidateId: "c1", resumeAt: null }],
  });
  const today = observePracticeSchedule(root, T + MINUTE);
  expect(today.nextDueAt).toBe(nextUtcDayAt(T));
  // ADR-0597: a resident's offset delays the daily usage wake by the same amount.
  expect(observePracticeSchedule(root, T + MINUTE, 5 * MINUTE).nextDueAt).toBe(
    nextUtcDayAt(T, 5 * MINUTE),
  );
  const tomorrow = observePracticeSchedule(root, nextUtcDayAt(T) + MINUTE);
  expect(tomorrow.dueDigest).not.toBe(today.dueDigest);
  expect(observePracticeSchedule(root, T + 6 * 86_400_000).nextDueAt).toBe(
    nextUtcDayAt(T + 6 * 86_400_000),
  );
  // The candidate's 7-day expiry is due on the seventh day.
  const seventh = T + 7 * 86_400_000;
  expect(observePracticeSchedule(root, seventh - MINUTE).dueDigest).not.toBe(
    observePracticeSchedule(root, seventh).dueDigest,
  );
});

it("throws on unreadable practice state so the fence keeps its clock window", async () => {
  await mkdir(resolve(root, PRACTICE_ROOT), { recursive: true });
  await writeFile(resolve(root, PRACTICE_ROOT, "state.json"), "{not json");
  expect(() => observePracticeSchedule(root, T)).toThrow();
  await writeFile(resolve(root, PRACTICE_ROOT, "state.json"), JSON.stringify({ schemaVersion: 2 }));
  expect(() => observePracticeSchedule(root, T)).toThrow("Invalid practice state.");
});
