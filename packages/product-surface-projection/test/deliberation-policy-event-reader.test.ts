import { deliberationPolicyHash } from "@lervo/deliberation";
import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { policy } from "../../deliberation/test/fixtures.js";
import { readDeliberationPolicyEvent } from "../src/index.js";

const deliberationId = "dlb_architecture_0001";
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function startedEvent(includePolicy = true): EventEnvelope {
  return {
    eventId: "evt_deliberation_started",
    projectId: policy.projectId,
    runId: "run_deliberation_control",
    sessionId: "ses_deliberation_control",
    seq: 1,
    type: "deliberation.started",
    occurredAt: "2026-09-17T00:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: hash("1"),
    payload: {
      deliberationId,
      policyId: policy.policyId,
      policyHash: deliberationPolicyHash(policy),
      participantRoleIds: policy.participants.map((participant) => participant.roleId),
      maxRounds: policy.maxRounds,
      ...(includePolicy ? { policy } : {}),
    },
    previousHash: null,
    eventHash: hash("2"),
  };
}

describe("deliberation policy event reader", () => {
  it("restores the exact source-bound policy", () => {
    expect(
      readDeliberationPolicyEvent({
        projectId: policy.projectId,
        deliberationId,
        events: [startedEvent()],
      }),
    ).toEqual({
      status: "complete",
      policy,
      startedEventId: "evt_deliberation_started",
      reasonCode: null,
    });
  });

  it("keeps a legacy hash-only start readable but unavailable for exact reconstruction", () => {
    expect(
      readDeliberationPolicyEvent({
        projectId: policy.projectId,
        deliberationId,
        events: [startedEvent(false)],
      }),
    ).toMatchObject({
      status: "unavailable",
      policy: null,
      reasonCode: "deliberation_policy_unavailable",
    });
  });

  it("fails a contradictory embedded policy closed", () => {
    const event = startedEvent();
    expect(
      readDeliberationPolicyEvent({
        projectId: policy.projectId,
        deliberationId,
        events: [
          {
            ...event,
            payload: { ...event.payload, policyHash: hash("f") },
          },
        ],
      }),
    ).toMatchObject({
      status: "invalid",
      policy: null,
      reasonCode: "deliberation_policy_event_invalid",
    });
  });
});
