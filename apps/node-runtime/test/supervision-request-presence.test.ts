import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";
import { findBoundSupervisionRequestEvent } from "../src/supervision-request-presence.js";

const binding = {
  supervisionId: "supervision.project",
  workstreamId: `wks_${"a".repeat(24)}`,
  ownerAgentId: `agt_${"b".repeat(24)}`,
  mandateHash: `sha256:${"c".repeat(64)}`,
};

function event(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    seq: 1,
    eventId: `evt_${"d".repeat(32)}`,
    eventHash: `sha256:${"e".repeat(64)}`,
    previousHash: null,
    projectId: `prj_${"f".repeat(16)}`,
    runId: `run_${"1".repeat(32)}`,
    sessionId: `ses_${"2".repeat(32)}`,
    type: "work.supervision.bound",
    schemaVersion: 3,
    occurredAt: "2026-09-22T00:00:00.000Z",
    actor: { kind: "system" },
    policyVersion: `sha256:${"3".repeat(64)}`,
    payload: {
      supervisionId: binding.supervisionId,
      workstreamId: binding.workstreamId,
      ownerAgentId: binding.ownerAgentId,
    },
    ...overrides,
  } as EventEnvelope;
}

function source(events: EventEnvelope[]) {
  return {
    list: ({ afterSeq = 0 }: { afterSeq?: number }) => events.filter((item) => item.seq > afterSeq),
  };
}

describe("bound supervision request presence", () => {
  it("finds only the exact project, workstream, supervision and owner coordinate", () => {
    const exact = event();
    expect(
      findBoundSupervisionRequestEvent({
        events: source([exact]),
        projectId: exact.projectId,
        binding,
      }),
    ).toBe(exact);
    expect(
      findBoundSupervisionRequestEvent({
        events: source([event({ projectId: `prj_${"0".repeat(16)}` })]),
        projectId: exact.projectId,
        binding,
      }),
    ).toBeNull();
  });

  it("rejects multiple origins instead of selecting one", () => {
    expect(() =>
      findBoundSupervisionRequestEvent({
        events: source([event(), event({ seq: 2, eventId: `evt_${"4".repeat(32)}` })]),
        projectId: `prj_${"f".repeat(16)}`,
        binding,
      }),
    ).toThrow(/conflicting request origins/iu);
  });
});
