import { describe, expect, it } from "vitest";

import type { ConvergenceOwnerVerdict } from "../src/convergence-owner-verdict.js";
import { nonOwnerHealth, ownershipFingerprint } from "../src/resident-ownership.js";

const observedAt = Date.parse("2026-11-28T11:49:51.116Z");
const lapses = observedAt + 60 * 60_000;

function ineligible(
  reason: "provider_not_admitted" | "knowledge_authority_unavailable",
  wakeAt: number | null,
): ConvergenceOwnerVerdict {
  return {
    role: "ineligible",
    reason,
    mode: "hub",
    hostHash: `sha256:${"c".repeat(64)}`,
    hostLabel: "wsl",
    holder: null,
    validUntil: null,
    wakeAt: wakeAt === null ? null : new Date(wakeAt).toISOString(),
    grantedAt: null,
    yieldUntil: null,
    observedAt: new Date(observedAt).toISOString(),
  };
}

const source = {
  fingerprint: `sha256:${"d".repeat(64)}`,
  sourceDigest: `sha256:${"e".repeat(64)}`,
  earliestAvailableAt: null,
  localWakeAt: null,
};

describe("resident ownership for an ineligible host", () => {
  it("wakes when an unadmitted-provider observation lapses and reports that cause", () => {
    const verdict = ineligible("provider_not_admitted", lapses);
    // Without this wake, a host that logged its provider back in stayed ineligible, and every
    // knowledge effect read the stale fence, until an unrelated change woke the resident.
    expect(ownershipFingerprint(source, verdict).earliestAvailableAt).toBe(lapses);
    expect(nonOwnerHealth(verdict)).toEqual({ state: "waiting", reason: "provider_not_admitted" });
  });

  it("keeps waiting for a change when no usable delegation exists", () => {
    const verdict = ineligible("knowledge_authority_unavailable", null);
    expect(ownershipFingerprint(source, verdict).earliestAvailableAt).toBeNull();
    expect(nonOwnerHealth(verdict)).toEqual({
      state: "waiting",
      reason: "knowledge_authority_unavailable",
    });
  });
});
