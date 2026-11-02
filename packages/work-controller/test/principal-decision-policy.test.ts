import type { OperatingActionKind } from "@lervo/application-contract";
import { describe, expect, it } from "vitest";
import {
  decidePrincipalEscalation,
  principalEscalationBoundElapsed,
  principalEscalationBoundMs,
} from "../src/index.js";

const now = "2026-11-02T03:00:00.000Z";
const mandate = (actionKinds: OperatingActionKind[], expiresAt = "2026-11-03T00:00:00.000Z") => ({
  actionKinds,
  expiresAt,
});

describe("principal proxy decision policy", () => {
  it("settles an escalation with the first in-mandate action instead of asking the owner", () => {
    expect(
      decidePrincipalEscalation({
        reasonCode: "acceptance_rejected",
        mandate: mandate(["escalate", "allocate_existing", "revise_responsibility"]),
        now,
      }),
    ).toEqual({
      kind: "settle",
      nextAction: "revise_responsibility",
      reasonCode: "principal_proxy_acceptance_rejected",
    });
    expect(
      decidePrincipalEscalation({
        reasonCode: "worker_failed",
        mandate: mandate(["escalate", "allocate_existing"]),
        now,
      }),
    ).toEqual({
      kind: "settle",
      nextAction: "allocate_existing",
      reasonCode: "principal_proxy_worker_failed",
    });
  });
  it("holds work outside every mandate action as Lervo debt", () => {
    expect(
      decidePrincipalEscalation({
        reasonCode: "scoped_handoff_acceptance_pending",
        mandate: mandate(["escalate", "allocate_existing", "revise_responsibility"]),
        now,
      }),
    ).toEqual({ kind: "lervo_debt", reasonCode: "principal_scope_exceeded" });
    expect(
      decidePrincipalEscalation({
        reasonCode: "assignment_blocked",
        mandate: mandate(["escalate", "dispatch"]),
        now,
      }),
    ).toEqual({ kind: "lervo_debt", reasonCode: "principal_scope_exceeded" });
  });
  it("holds an escalation under an expired mandate as Lervo debt", () => {
    expect(
      decidePrincipalEscalation({
        reasonCode: "acceptance_blocked",
        mandate: mandate(["revise_responsibility"], now),
        now,
      }),
    ).toEqual({ kind: "lervo_debt", reasonCode: "principal_mandate_expired" });
    expect(() =>
      decidePrincipalEscalation({
        reasonCode: "Not A Code",
        mandate: mandate(["revise_responsibility"]),
        now,
      }),
    ).toThrow("principal escalation input is invalid");
  });
  it("passes the bound at escalation capacity or after the batch window", () => {
    const at = (elapsedMs: number) => new Date(Date.parse(now) + elapsedMs).toISOString();
    expect(
      principalEscalationBoundElapsed({ escalationCount: 8, attentionPendingSince: null, now }),
    ).toBe(true);
    expect(
      principalEscalationBoundElapsed({ escalationCount: 1, attentionPendingSince: now, now }),
    ).toBe(false);
    expect(
      principalEscalationBoundElapsed({
        escalationCount: 1,
        attentionPendingSince: now,
        now: at(principalEscalationBoundMs - 1),
      }),
    ).toBe(false);
    expect(
      principalEscalationBoundElapsed({
        escalationCount: 1,
        attentionPendingSince: now,
        now: at(principalEscalationBoundMs),
      }),
    ).toBe(true);
  });
});
