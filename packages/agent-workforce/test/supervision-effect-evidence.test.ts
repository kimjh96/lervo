import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { describe, expect, it } from "vitest";

import { isDecisionBoundSupervisionEffectEvidence } from "../src/supervision-effect-evidence.js";

const decisionId = "osd_fixture";
const decisionEventId = `evt_${"a".repeat(32)}`;
const terminalEventId = `evt_${"b".repeat(32)}`;
const ownerRunId = `run_${"c".repeat(32)}`;
const decisionRunId = `run_${"d".repeat(32)}`;
const type = "work.supervision.owner_reasoning.interruption_reconciled";
const coordinates = {
  supervisionId: "supervision.fixture",
  workstreamId: `wks_${"e".repeat(24)}`,
  workstreamRevision: 1,
  ownerAgentId: `agt_${"f".repeat(24)}`,
  mandateHash: `sha256:${"1".repeat(64)}`,
  decisionId,
  planHash: `sha256:${"2".repeat(64)}`,
};

function event(value: Record<string, unknown>): EventEnvelope {
  return value as EventEnvelope;
}

describe("interrupted owner effect evidence", () => {
  const decision = event({
    eventId: decisionEventId,
    runId: decisionRunId,
    seq: 1,
    payload: { ...coordinates, actionKind: "execute_as_owner" },
  });
  const terminal = event({
    eventId: terminalEventId,
    runId: ownerRunId,
    seq: 2,
    type: "run.failed",
    payload: { failureCode: "provider_stop_failed", retryable: false },
  });
  const reconciliation = event({
    eventId: `evt_${operatingContractHash({ runId: decisionRunId, type, identity: decisionId }).slice(7, 39)}`,
    runId: decisionRunId,
    seq: 3,
    type,
    schemaVersion: 3,
    actor: { kind: "system" },
    payload: {
      ...coordinates,
      managedRunId: ownerRunId,
      terminalEventId,
      causationEventIds: [decisionEventId, terminalEventId],
    },
  });
  const events = { get: (id: string) => (id === terminalEventId ? terminal : null) } as EventStore;

  it("accepts only the decision-bound record with its exact earlier stop-failure terminal", () => {
    expect(isDecisionBoundSupervisionEffectEvidence(reconciliation, decision, events)).toBe(true);
    expect(
      isDecisionBoundSupervisionEffectEvidence(reconciliation, decision, {
        get: () => ({
          ...terminal,
          payload: { ...terminal.payload, failureCode: "provider_start_failed" },
        }),
      } as unknown as EventStore),
    ).toBe(true);
    for (const payload of [
      { planHash: `sha256:${"3".repeat(64)}` },
      { causationEventIds: [terminalEventId, decisionEventId] },
      { managedRunId: decisionRunId },
    ])
      expect(
        isDecisionBoundSupervisionEffectEvidence(
          event({ ...reconciliation, payload: { ...reconciliation.payload, ...payload } }),
          decision,
          events,
        ),
      ).toBe(false);
    expect(
      isDecisionBoundSupervisionEffectEvidence(reconciliation, decision, {
        get: () => null,
      } as unknown as EventStore),
    ).toBe(false);
  });
});
