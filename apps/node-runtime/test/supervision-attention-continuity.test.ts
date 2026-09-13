import { expect, it } from "vitest";
import type { EventEnvelope, WorkstreamSnapshot } from "@lervo/schemas";
import { mandate } from "../../../packages/work-controller/test/operating-supervision.fixture.js";
import { retainsExhaustedRecoveryAttention } from "../src/supervision-attention-continuity.js";

const decisionId = `osd_${"a".repeat(24)}`;
const priorMandate = { ...mandate(), maximumAttemptsPerAssignment: 2 };
const renewedMandate = {
  ...priorMandate,
  version: 2,
  issuedAt: "2026-09-12T00:00:00.000Z",
  expiresAt: "2026-09-13T00:00:00.000Z",
};
const priorWorkstream: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: `wks_${"a".repeat(24)}`,
  revision: 1,
  status: "active",
  title: "Complete one research result",
  objective: "Accept the exact sourced artifact.",
  nextActions: ["Recover the failed attempt."],
  blockers: [],
  notes: [],
  references: [],
  origin: {
    kind: "created",
    sourceArtifactId: null,
    sourceContentHash: null,
    sourcePathDigest: null,
  },
  updatedAt: "2026-09-11T03:00:00.000Z",
};
const renewedWorkstream: WorkstreamSnapshot = {
  ...priorWorkstream,
  revision: 2,
  notes: ["Record the same blocked research state."],
  updatedAt: "2026-09-12T03:00:00.000Z",
};
const event = (type: EventEnvelope["type"], payload: Record<string, unknown>) =>
  ({ type, payload }) as EventEnvelope;
const administrativeEvents = [
  event("work.supervision.effect.observed", {
    decisionId,
    status: "effect_confirmed",
  }),
  event("workstream.snapshot.recorded", {}),
  event("work.supervision.mandate.installed", {}),
];
const exhausted = [
  {
    status: "failed" as const,
    effectDisposition: "known_safe_failure" as const,
    recoveryDecisionCount: 1,
  },
];
const basis = {
  reasonCode: "retry_budget_requires_resolution",
  decisionId,
  previousMandate: priorMandate,
  currentMandate: renewedMandate,
  previousWorkstream: priorWorkstream,
  currentWorkstream: renewedWorkstream,
  interveningEvents: administrativeEvents,
  assignments: exhausted,
};

it("retains exhausted retry attention across validity-only renewal and workstream bookkeeping", () => {
  expect(retainsExhaustedRecoveryAttention(basis)).toBe(true);
});

it("releases attention when retry authority, goal purpose, or task evidence changes", () => {
  expect(
    retainsExhaustedRecoveryAttention({
      ...basis,
      currentMandate: { ...renewedMandate, maximumAttemptsPerAssignment: 3 },
    }),
  ).toBe(false);
  expect(
    retainsExhaustedRecoveryAttention({
      ...basis,
      currentWorkstream: { ...renewedWorkstream, objective: "A different research request." },
    }),
  ).toBe(false);
  expect(
    retainsExhaustedRecoveryAttention({
      ...basis,
      interveningEvents: [...administrativeEvents, event("run.failed", {})],
    }),
  ).toBe(false);
  expect(
    retainsExhaustedRecoveryAttention({
      ...basis,
      assignments: [{ ...exhausted[0]!, status: "leased" }],
    }),
  ).toBe(false);
  expect(
    retainsExhaustedRecoveryAttention({ ...basis, reasonCode: "source_policy_decision_required" }),
  ).toBe(false);
});

it("rejects unrelated receipts and resource-scope changes", () => {
  expect(
    retainsExhaustedRecoveryAttention({
      ...basis,
      interveningEvents: [
        event("work.supervision.effect.observed", {
          decisionId: `osd_${"b".repeat(24)}`,
          status: "effect_confirmed",
        }),
      ],
    }),
  ).toBe(false);
  expect(
    retainsExhaustedRecoveryAttention({
      ...basis,
      currentMandate: { ...renewedMandate, maximumAggregateTokens: 20_000 },
    }),
  ).toBe(false);
});
