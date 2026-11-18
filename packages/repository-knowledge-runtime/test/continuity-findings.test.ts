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

  it("holds Lervo debt, never an owner decision, only when no policy can keep the delegation alive", () => {
    expect(
      codes(
        input({
          policy: { status: "absent" },
          renewal: { kind: "no_policy" },
          delegation: { state: "active", expiresAt: new Date(now + 60 * HOUR).toISOString() },
        }),
      ),
    ).toEqual(["lervo_debt:delegation_expiring", "info:policy_absent"]);
    expect(
      codes(
        input({
          renewal: { kind: "outside_policy", reason: "provider_outside_policy" },
          delegation: { state: "active", expiresAt: new Date(now + HOUR).toISOString() },
        }),
      ),
    ).toEqual(["lervo_debt:delegation_outside_policy"]);
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
    ).toEqual(["lervo_debt:delegation_missing", "info:policy_absent"]);
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

  it("names a failed definition exchange only while host records still work (ADR-0477)", () => {
    expect(
      continuityFindings(input({ definitionExchangeFailure: "hub_definitions_unsupported" })),
    ).toEqual([
      {
        code: "definition_exchange_unavailable",
        severity: "attention",
        detail: "hub_definitions_unsupported",
      },
    ]);
    expect(
      continuityFindings(
        input({ hubFailure: "hub_unreachable", definitionExchangeFailure: "hub_unreachable" }),
      ).map((finding) => finding.code),
    ).toEqual(["hub_unavailable"]);
  });

  it("reports the latest failed cycle with only its code, including legacy failures", () => {
    const base = {
      now,
      expected: false,
      stateObservedAt: null,
      residentRunning: true,
      hookRuntime: "current" as const,
      replicaDiverged: false,
    };
    const lastFailure = {
      code: "source_bytes_changed",
      detail: "./docs/a.md changed",
      at: new Date(now).toISOString(),
    };
    expect(
      localContinuityFindings({
        ...base,
        residentCycle: { lastResult: "failed", lastFailure },
      }),
    ).toEqual([
      { code: "resident_cycle_failed", severity: "attention", detail: "source_bytes_changed" },
    ]);
    expect(localContinuityFindings({ ...base, residentCycle: { lastResult: "failed" } })).toEqual([
      { code: "resident_cycle_failed", severity: "attention", detail: "unclassified_failure" },
    ]);
    expect(
      localContinuityFindings({
        ...base,
        residentCycle: { lastResult: "idle", lastFailure: null },
      }),
    ).toEqual([]);
  });

  it("adds local gaps only for checkouts that should have a resident", () => {
    expect(
      localContinuityFindings({
        now,
        expected: false,
        stateObservedAt: null,
        residentRunning: false,
        hookRuntime: "unavailable",
        replicaDiverged: false,
      }).map((finding) => finding.code),
    ).toEqual(["hook_runtime_unavailable"]);
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

  it("reports a held resident's cause instead of an absent resident (ADR-0470)", () => {
    const base = {
      now,
      expected: true,
      stateObservedAt: null,
      residentRunning: true,
      hookRuntime: "current" as const,
      replicaDiverged: false,
    };
    expect(localContinuityFindings({ ...base, residentHold: "event_schema_outdated" })).toEqual([
      { code: "event_schema_outdated", severity: "attention", detail: null },
    ]);
    expect(
      localContinuityFindings({
        ...base,
        residentRunning: false,
        residentHost: {
          kind: "host_held",
          reason: "event_schema_outdated",
          detail: "terminal_hook_reader_stale",
        },
      }),
    ).toEqual([
      {
        code: "event_schema_outdated",
        severity: "attention",
        detail: "terminal_hook_reader_stale",
      },
    ]);
  });

  it("reports an owner's degraded resident as non-blocking convergence attention (ADR-0530)", () => {
    const base = {
      now,
      expected: true,
      stateObservedAt: new Date(now).toISOString(),
      residentRunning: true,
      hookRuntime: "current" as const,
      replicaDiverged: false,
      residentHold: "knowledge_sources_parked",
    };
    expect(localContinuityFindings({ ...base, owner: true })).toEqual([
      { code: "convergence_attention", severity: "attention", detail: "knowledge_sources_parked" },
    ]);
    expect(localContinuityFindings({ ...base, owner: false })).toEqual([]);
    expect(
      localContinuityFindings({ ...base, owner: true, residentHold: "event_schema_outdated" }),
    ).toEqual([{ code: "event_schema_outdated", severity: "attention", detail: null }]);
  });

  it("treats a checkout the running host resident serves as pending, not unobserved", () => {
    const base = {
      now,
      expected: true,
      stateObservedAt: null,
      residentRunning: false,
      hookRuntime: "current" as const,
      replicaDiverged: false,
    };
    expect(localContinuityFindings({ ...base, residentHost: { kind: "host_serving" } })).toEqual([
      { code: "continuity_pending", severity: "info", detail: null },
    ]);
    expect(localContinuityFindings({ ...base, residentHost: { kind: "host_absent" } })).toEqual([
      { code: "continuity_unobserved", severity: "attention", detail: "host_resident_absent" },
      { code: "resident_not_running", severity: "attention", detail: "host_resident_absent" },
    ]);
    expect(
      localContinuityFindings({ ...base, residentHost: { kind: "node" } }).map(
        (finding) => finding.detail,
      ),
    ).toEqual(["node_served", "node_served"]);
  });
});
