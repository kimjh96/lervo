import { describe, expect, it } from "vitest";

import {
  continuityFindings,
  localContinuityFindings,
  type ContinuityFindingsInput,
} from "../src/continuity-findings.js";
import { sealConvergenceContinuityPolicy } from "../src/continuity-policy.js";

const HOUR = 60 * 60_000;
const now = Date.parse("2026-10-06T00:00:00.000Z");
const ceilings = {
  maximumStages: 8,
  maximumDocuments: 8,
  maximumSourceBytes: 1_048_576,
  maximumProviderCalls: 8,
};
const policy = sealConvergenceContinuityPolicy({
  schemaVersion: 1,
  state: "active",
  authority: { kind: "owner_instruction", reference: "ADR-0469" },
  issuedAt: new Date(now - HOUR).toISOString(),
  horizonAt: new Date(now + 300 * 24 * HOUR).toISOString(),
  renewal: { termDays: 30, windowHours: 48, attentionLeadHours: 72 },
  seeding: { fromPeer: true, fromTemplate: false },
  limits: { providers: ["codex"], resourceCeilings: ceilings },
  template: null,
});

function input(overrides: Partial<ContinuityFindingsInput> = {}): ContinuityFindingsInput {
  return {
    now,
    delegation: { state: "active", expiresAt: new Date(now + 10 * 24 * HOUR).toISOString() },
    policy: { status: "loaded", policy },
    renewal: { kind: "current", renewAt: new Date(now + 8 * 24 * HOUR).toISOString() },
    continuationFailure: null,
    ownerHost: { state: "hub", hubFailureCode: null, publication: "configured" },
    verdict: { role: "owner", failureCode: null },
    publicationStatus: "idle",
    hubFailure: null,
    peers: [],
    ...overrides,
  };
}

const codes = (value: ContinuityFindingsInput) =>
  continuityFindings(value).map((finding) => `${finding.severity}:${finding.code}`);

describe("continuity findings", () => {
  it("reports nothing for a renewable, coordinated, publishing host", () => {
    expect(codes(input())).toEqual([]);
  });

  it("raises an owner decision only when no policy can keep the delegation alive", () => {
    expect(
      codes(
        input({
          policy: { status: "absent" },
          renewal: { kind: "no_policy" },
          delegation: { state: "active", expiresAt: new Date(now + 60 * HOUR).toISOString() },
        }),
      ),
    ).toEqual(["owner_decision:delegation_expiring", "info:policy_absent"]);
    expect(
      codes(
        input({
          renewal: { kind: "outside_policy", reason: "provider_outside_policy" },
          delegation: { state: "active", expiresAt: new Date(now + HOUR).toISOString() },
        }),
      ),
    ).toEqual(["owner_decision:delegation_outside_policy"]);
    // Within the window and renewable: the resident renews it, so no item at all.
    expect(
      codes(
        input({
          renewal: { kind: "renew", expiresAt: new Date(now + 30 * 24 * HOUR).toISOString() },
          delegation: { state: "active", expiresAt: new Date(now + HOUR).toISOString() },
        }),
      ),
    ).toEqual([]);
  });

  it("treats a never-delegated repository as not enrolled unless a policy or peer expects it", () => {
    const missing = { delegation: { state: "missing" as const }, renewal: null };
    expect(codes(input({ ...missing, policy: { status: "absent" } }))).toEqual([
      "info:delegation_missing",
      "info:policy_absent",
    ]);
    expect(codes(input(missing))).toEqual(["attention:delegation_missing"]);
    expect(
      codes(
        input({
          ...missing,
          policy: { status: "absent" },
          peers: [
            {
              hostLabel: "wsl",
              observedAt: new Date(now).toISOString(),
              delegationState: "active",
              delegationExpiresAt: new Date(now + 10 * 24 * HOUR).toISOString(),
              policy: "active",
            },
          ],
        }),
      ),
    ).toEqual(["owner_decision:delegation_missing", "info:policy_absent"]);
  });

  it("names Hub, lease, publication, and peer gaps with their causes", () => {
    const findings = continuityFindings(
      input({
        ownerHost: {
          state: "standalone",
          hubFailureCode: "hub_forbidden",
          publication: "not_applicable",
        },
        verdict: { role: "unverifiable", failureCode: "hub_unreachable" },
        publicationStatus: "failed",
        hubFailure: "hub_unreachable",
        peers: [
          {
            hostLabel: "wsl",
            observedAt: new Date(now - 3 * HOUR).toISOString(),
            delegationState: "active",
            delegationExpiresAt: null,
            policy: "active",
          },
          {
            hostLabel: "mac",
            observedAt: new Date(now).toISOString(),
            delegationState: "active",
            delegationExpiresAt: new Date(now + HOUR).toISOString(),
            policy: "absent",
          },
        ],
      }),
    );
    expect(findings).toEqual([
      { code: "owner_host_hub_unusable", severity: "attention", detail: "hub_forbidden" },
      { code: "lease_unverifiable", severity: "attention", detail: "hub_unreachable" },
      { code: "publication_failed", severity: "attention", detail: "failed" },
      { code: "hub_unavailable", severity: "attention", detail: "hub_unreachable" },
      { code: "peer_unreported", severity: "info", detail: "wsl" },
      { code: "peer_delegation_expiring", severity: "attention", detail: "mac" },
    ]);
  });

  it("adds local gaps only for checkouts that should have a resident", () => {
    expect(
      localContinuityFindings({
        now,
        expected: false,
        stateObservedAt: null,
        residentRunning: false,
        hookRuntime: "stale",
        replicaDiverged: false,
      }).map((finding) => finding.code),
    ).toEqual(["hook_runtime_stale"]);
    expect(
      localContinuityFindings({
        now,
        expected: true,
        stateObservedAt: new Date(now - 3 * HOUR).toISOString(),
        residentRunning: false,
        hookRuntime: "current",
        replicaDiverged: true,
      }).map((finding) => finding.code),
    ).toEqual(["continuity_stale", "resident_not_running", "replica_diverged"]);
  });
});
