import { expect, it } from "vitest";
import { conversationResponseRequestDigest } from "../src/request.js";
import { managedConversationTurnRequestDigest } from "../src/managed-turn-contract.js";
import type {
  ManagedConversationResponsePlan,
  ManagedConversationResponseRequest,
  ManagedConversationTurnRequest,
} from "../src/types.js";

it("invalidates both response caches when the current quality plan changes", () => {
  const request = {
    event: { eventId: "evt_fixture", actor: { kind: "human" }, content: { contentHash: "hash" } },
    policy: { policyId: "policy" },
    decision: { action: "reply" },
  } as unknown as ManagedConversationResponseRequest;
  const plan = {
    role: { roleId: "reviewer" },
    executionIdentity: {},
    contextQuality: { planDigest: "first", observe: async () => ({ completionAllowed: true }) },
  } as unknown as ManagedConversationResponsePlan;
  const response = () =>
    conversationResponseRequestDigest({ request, plan, policyVersion: "policy" });
  const turn = () =>
    managedConversationTurnRequestDigest({
      request: request as unknown as ManagedConversationTurnRequest,
      plan,
      policyVersion: "policy",
    });
  const first = [response(), turn()];
  plan.contextQuality!.planDigest = "second";
  expect(response()).not.toBe(first[0]);
  expect(turn()).not.toBe(first[1]);
});
