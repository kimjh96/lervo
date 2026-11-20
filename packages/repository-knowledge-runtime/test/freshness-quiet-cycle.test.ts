import { expect, it } from "vitest";

import {
  freshnessCycleNewsworthy,
  freshnessOutcomeDigest,
} from "../src/freshness-cycle-observation.js";
import { freshnessBackoffDue } from "../src/freshness-debt-state.js";
import { emptyFreshnessCycleState } from "../src/freshness-state-store.js";

const now = new Date("2026-11-20T03:50:00.000Z");
const quiet = {
  deferred: null,
  admittedCount: 0,
  candidateCount: 0,
  verifiedCount: 0,
  appliedCount: 0,
  tokensObserved: 0,
};
// The payload the WSL plen owner appended about every two minutes on 2026-11-20.
const plen = (cycleId: string) => ({
  cycleId,
  findingCount: 7,
  admittedCount: 0,
  candidateCount: 0,
  verifiedCount: 0,
  appliedCount: 0,
  skippedForBudget: 1,
  skippedForHold: 2,
  usageObserved: 0,
  occurredAt: now.toISOString(),
});

it("records a quiet cycle once and then nothing while it repeats (ADR-0598)", () => {
  const digest = freshnessOutcomeDigest(plen("kfcy_a"));
  expect(freshnessOutcomeDigest(plen("kfcy_b"))).toBe(digest);
  const previous = { findingsDigest: "sha256:f", lastOutcomeDigest: null };
  expect(
    freshnessCycleNewsworthy({
      previous,
      findingsDigest: "sha256:f",
      outcomeDigest: digest,
      outcome: quiet,
    }),
  ).toBe(true);
  const recorded = { ...previous, lastOutcomeDigest: digest };
  expect(
    freshnessCycleNewsworthy({
      previous: recorded,
      findingsDigest: "sha256:f",
      outcomeDigest: digest,
      outcome: quiet,
    }),
  ).toBe(false);
  // A changed outcome, new findings, or any progress is news again.
  expect(
    freshnessCycleNewsworthy({
      previous: recorded,
      findingsDigest: "sha256:f",
      outcomeDigest: freshnessOutcomeDigest({ ...plen("kfcy_c"), skippedForHold: 3 }),
      outcome: quiet,
    }),
  ).toBe(true);
  expect(
    freshnessCycleNewsworthy({
      previous: recorded,
      findingsDigest: "sha256:g",
      outcomeDigest: digest,
      outcome: quiet,
    }),
  ).toBe(true);
  expect(
    freshnessCycleNewsworthy({
      previous: recorded,
      findingsDigest: "sha256:f",
      outcomeDigest: digest,
      outcome: { ...quiet, tokensObserved: 10 },
    }),
  ).toBe(true);
  // ADR-0580 still holds: a deferral without progress records nothing, whatever it reports.
  expect(
    freshnessCycleNewsworthy({
      previous,
      findingsDigest: "sha256:f",
      outcomeDigest: "sha256:other",
      outcome: { ...quiet, deferred: "live_work_pending" },
    }),
  ).toBe(false);
});

it("counts a due debt retry only when today's budget can pay for it", () => {
  const state = {
    ...emptyFreshnessCycleState(),
    debt: [
      {
        findingDigest: "sha256:finding",
        documentPath: "docs/runtime.md",
        candidateId: "kfc_1",
        reason: "budget_exceeded" as const,
        since: "2026-11-19T00:00:00.000Z",
        attempts: 1,
        retryAt: "2026-11-20T00:05:00.000Z",
      },
    ],
  };
  expect(freshnessBackoffDue(state, [], now)).toBe(true);
  expect(freshnessBackoffDue(state, [], now, { debtAffordable: true })).toBe(true);
  expect(freshnessBackoffDue(state, [], now, { debtAffordable: false })).toBe(false);
  // The zero-success hold expiring still reopens the stage on its own.
  expect(
    freshnessBackoffDue(
      {
        ...state,
        zeroSuccessHold: {
          since: "2026-11-19T00:00:00.000Z",
          until: "2026-11-20T01:00:00.000Z",
          level: 0,
        },
      },
      [],
      now,
      { debtAffordable: false },
    ),
  ).toBe(true);
});
