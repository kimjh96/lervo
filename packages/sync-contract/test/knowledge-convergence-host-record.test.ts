import { describe, expect, it } from "vitest";

import {
  isKnowledgeConvergenceHostRecord,
  knowledgeConvergenceScopeHash,
  mergeKnowledgeConvergenceHostRecord,
  type KnowledgeConvergenceHostRecord,
} from "../src/knowledge-convergence-host-record.js";

const scope = { canonicalRoots: ["docs"], providers: ["codex"] };

function hostRecord(
  overrides: Partial<KnowledgeConvergenceHostRecord> = {},
): KnowledgeConvergenceHostRecord {
  return {
    schemaVersion: 1,
    projectId: "prj_convergence_hosts",
    repositoryIdentityHash: `sha256:${"3".repeat(64)}`,
    hostHash: `sha256:${"1".repeat(64)}`,
    hostLabel: "mac",
    observedAt: "2026-10-06T00:00:00.000Z",
    delegation: {
      state: "active",
      expiresAt: "2026-10-07T19:00:00.000Z",
      scopeHash: knowledgeConvergenceScopeHash(scope),
      scope,
    },
    continuity: { policy: "active", horizonAt: "2027-10-06T00:00:00.000Z" },
    owner: { role: "owner", reason: "lease_held" },
    publication: { configured: true, status: "idle" },
    resident: { state: "idle", reason: "waiting_owner:wsl" },
    findings: ["delegation_expiring"],
    ...overrides,
  };
}

describe("knowledge convergence host record", () => {
  it("accepts a bounded record whose scope matches its hash", () => {
    expect(isKnowledgeConvergenceHostRecord(hostRecord())).toBe(true);
    expect(isKnowledgeConvergenceHostRecord(hostRecord({ delegation: null }))).toBe(true);
    expect(
      isKnowledgeConvergenceHostRecord(hostRecord({ findings: ["resident_cycle_failed"] })),
    ).toBe(true);
  });

  it("rejects a tampered scope, unknown keys, and free-text findings", () => {
    const tampered = hostRecord();
    tampered.delegation!.scope = { ...scope, providers: ["claude"] };
    expect(isKnowledgeConvergenceHostRecord(tampered)).toBe(false);
    expect(isKnowledgeConvergenceHostRecord({ ...hostRecord(), hostname: "mac.local" })).toBe(
      false,
    );
    expect(isKnowledgeConvergenceHostRecord(hostRecord({ findings: ["Delegation expires"] }))).toBe(
      false,
    );
    expect(isKnowledgeConvergenceHostRecord(hostRecord({ hostLabel: "Mac Book" }))).toBe(false);
  });

  it("rejects a record beyond the byte limit", () => {
    const large = { roots: Array.from({ length: 2_000 }, (_, index) => `docs/${index}`) };
    expect(
      isKnowledgeConvergenceHostRecord(
        hostRecord({
          delegation: {
            state: "active",
            expiresAt: "2026-10-07T19:00:00.000Z",
            scopeHash: knowledgeConvergenceScopeHash(large),
            scope: large,
          },
        }),
      ),
    ).toBe(false);
  });

  it("keeps the newer observation of one host", () => {
    const current = hostRecord({ observedAt: "2026-10-06T01:00:00.000Z" });
    expect(mergeKnowledgeConvergenceHostRecord({ current: null, incoming: current }).status).toBe(
      "created",
    );
    expect(
      mergeKnowledgeConvergenceHostRecord({
        current,
        incoming: hostRecord({ observedAt: "2026-10-06T00:30:00.000Z" }),
      }),
    ).toEqual({ next: current, status: "stale" });
    const newer = hostRecord({ observedAt: "2026-10-06T02:00:00.000Z" });
    expect(mergeKnowledgeConvergenceHostRecord({ current, incoming: newer })).toEqual({
      next: newer,
      status: "updated",
    });
  });
});
