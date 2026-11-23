import { describe, expect, it } from "vitest";

import {
  isKnowledgeConvergenceHostRecord,
  knowledgeConvergenceHostRecordFacts,
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

  it("compares facts without observation times or the presence a Hub listing adds (ADR-0602)", () => {
    const published = hostRecord();
    const listed = {
      ...hostRecord({ observedAt: "2026-10-06T00:05:00.000Z" }),
      presence: { connected: true, since: "2026-10-06T00:00:00.000Z" },
    };
    expect(knowledgeConvergenceHostRecordFacts(listed)).toBe(
      knowledgeConvergenceHostRecordFacts(published),
    );
    expect(
      knowledgeConvergenceHostRecordFacts(hostRecord({ findings: ["resident_cycle_failed"] })),
    ).not.toBe(knowledgeConvergenceHostRecordFacts(published));
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

it("exchanges detected and admitted provider versions while rejecting paths and provider output", () => {
  const providerAdmission: NonNullable<KnowledgeConvergenceHostRecord["providerAdmission"]> = {
    observedAt: "2026-10-31T00:00:00Z",
    detectionFailure: null,
    waiting: false,
    selected: { provider: "claude", version: "2.1.308" },
    providers: [
      {
        provider: "codex",
        version: "0.166.0",
        executableHash: `sha256:${"a".repeat(64)}`,
        admitted: false,
        reason: "capabilities_exposed",
        exposedTools: ["exec", "spawn_agent"],
      },
      {
        provider: "claude",
        version: "2.1.308",
        executableHash: `sha256:${"b".repeat(64)}`,
        admitted: true,
        reason: null,
        exposedTools: [],
      },
    ],
  };
  const incoming = hostRecord({ providerAdmission });
  expect(isKnowledgeConvergenceHostRecord(incoming)).toBe(true);
  expect(
    mergeKnowledgeConvergenceHostRecord({ current: null, incoming }).next.providerAdmission,
  ).toEqual(providerAdmission);
  expect(isKnowledgeConvergenceHostRecord(hostRecord())).toBe(true);
  expect(
    isKnowledgeConvergenceHostRecord({
      ...incoming,
      providerAdmission: { ...providerAdmission, executable: "/private/bin/claude" },
    }),
  ).toBe(false);
  expect(
    isKnowledgeConvergenceHostRecord({
      ...incoming,
      providerAdmission: {
        ...providerAdmission,
        providers: [{ ...providerAdmission.providers[0], exposedTools: ["private raw output"] }],
      },
    }),
  ).toBe(false);
});

describe("the transported model selection (ADR-0612 M3)", () => {
  const modelSelection = {
    schemaVersion: 1 as const,
    revision: 3,
    changedAt: "2026-11-23T05:00:00.000Z",
    roles: {
      routine: [{ provider: "claude", model: "claude-sonnet-5-5", reasoningEffort: null }],
      future_role: [{ provider: "claude", model: null, reasoningEffort: "high" }],
    },
  };

  it("accepts a record carrying a bounded selection, including roles a newer Lervo defines", () => {
    expect(isKnowledgeConvergenceHostRecord(hostRecord({ modelSelection }))).toBe(true);
  });

  it("rejects a selection with no revision, a bad role name, or too many routes", () => {
    for (const bad of [
      { ...modelSelection, revision: 0 },
      { ...modelSelection, changedAt: "yesterday" },
      { ...modelSelection, roles: { "Bad Role": modelSelection.roles.routine } },
      { ...modelSelection, roles: { routine: [] } },
      { ...modelSelection, roles: { routine: Array.from({ length: 5 }, () => ({})) } },
      { ...modelSelection, extra: true },
      { ...modelSelection, changedAt: "+275760-09-13T00:00:00.000Z" },
      {
        ...modelSelection,
        roles: { routine: [{ provider: "claude", model: { deep: 1 }, reasoningEffort: null }] },
      },
      { ...modelSelection, roles: { routine: [{ provider: "claude" }] } },
    ])
      expect(isKnowledgeConvergenceHostRecord(hostRecord({ modelSelection: bad as never }))).toBe(
        false,
      );
  });
});

it("rejects an impossible transported change time without throwing", () => {
  expect(() =>
    isKnowledgeConvergenceHostRecord(
      hostRecord({
        modelSelection: {
          schemaVersion: 1,
          revision: 1,
          changedAt: "2026-13-45T99:99:99.999Z",
          roles: {},
        },
      }),
    ),
  ).not.toThrow();
});
