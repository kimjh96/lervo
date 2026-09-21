import { describe, expect, it } from "vitest";

import type {
  ConversationInboundEvent,
  ConversationParticipationDecision,
  ConversationParticipationPolicy,
} from "@lervo/schemas";

import { runConversationResponseAttempt } from "../src/response-attempt.js";
import type { ConversationInteractionStore } from "../src/types.js";

describe("conversation response attempt", () => {
  it("reschedules an explicitly overloaded read-only provider turn with bounded backoff", async () => {
    const event = { eventId: "cve_capacity_example" } as ConversationInboundEvent;
    const policy = {
      policyId: "pol_capacity",
      roleId: "role_reviewer",
    } as ConversationParticipationPolicy;
    const decision = {} as ConversationParticipationDecision;
    let availableAt: string | null = null;
    const store = {
      async rescheduleInbound(input: { availableAt: string }) {
        availableAt = input.availableAt;
      },
    } as ConversationInteractionStore;
    const claimedAt = "2026-09-20T00:00:00.000Z";
    const result = await runConversationResponseAttempt({
      event,
      policy,
      decision,
      claim: { status: "claimed", leaseId: "lease_capacity", attemptCount: 1 },
      store,
      responder: {
        async respond() {
          throw new Error("private provider detail");
        },
      },
      publicationVerifier: { async verify() {} },
      responseFailureClassifier: {
        classify: () => ({ failureCode: "response_provider_capacity", retryable: true }),
      },
      agentParticipantId: "ptc_agent001",
      claimedAt,
      retryDelayMs: 5_000,
      maximumResponseAttempts: 2,
      clock: () => new Date(claimedAt),
    });
    expect(result).toMatchObject({
      status: "retry_scheduled",
      failureCode: "response_provider_capacity",
      nextAttemptAt: availableAt,
    });
    const delayMs = Date.parse(availableAt!) - Date.parse(claimedAt);
    expect(delayMs).toBeGreaterThanOrEqual(15_000);
    expect(delayMs).toBeLessThan(18_000);
  });
});
