import type { EventEnvelope } from "@lervo/schemas";
import type { RepositoryLayoutMigrationPlan } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  projectRepositoryHealth,
  type HealthProjectionSources,
} from "../src/repository-health-projection.js";
import {
  readHealthEventHistory,
  recordedConvergenceStops,
} from "../src/repository-health-events.js";
import { createOperatingAttentionReport } from "../src/operating-attention-projection.js";
import { formatRepositoryHealth } from "../src/repository-health-format.js";
import { healthNow, healthRevision } from "./repository-health-fixture.js";
import { healthFreshnessCandidate } from "./repository-health-freshness-fixture.js";

function sources(): HealthProjectionSources {
  return {
    now: healthNow,
    repositoryRevision: healthRevision,
    headRevision: "a".repeat(40),
    resident: {
      status: "healthy",
      state: "idle",
      heartbeatAt: healthNow.toISOString(),
      reason: null,
    },
    maintenance: {
      observedAt: healthNow.toISOString(),
      status: {
        state: "idle",
        reason: null,
        transport: "ready",
        outstanding: 0,
        oldestAgeMilliseconds: null,
        activeStage: null,
        debtCounts: null,
        lastVerifiedCurrency: null,
      },
    },
    continuity: null,
    staleness: {
      schemaVersion: 1,
      kind: "document_staleness.report",
      evaluator: "lervo.document-staleness.v1",
      status: "observed",
      currentRevision: "a".repeat(40),
      evaluatedAt: healthNow.toISOString(),
      coverage: "complete",
      counts: {
        documents: 1690,
        evaluated: 186,
        current: 115,
        stale: 71,
        unknown: 0,
        unevaluated: 1504,
      },
      stale: [],
      unknown: [],
      truncated: { stale: 0, unknown: 0 },
    },
    freshnessCycle: {
      lastCycleAt: healthNow.toISOString(),
      summary: {
        staleCount: 74,
        safetyCount: 1,
        awaitingReviewCount: 1,
        appliedRecentPaths: [],
        blocked: true,
      },
    },
    captureObservedAt: healthNow.toISOString(),
    attention: createOperatingAttentionReport({
      projectId: "prj_health",
      workstream: null,
      workstreamFreshness: null,
      canonicalization: { coverage: "complete", candidates: [] },
      knowledgeLifecycle: { coverage: "cached", issues: [] },
      observedAt: healthNow,
    }),
    layout: {
      deferredDocuments: [],
      deferredDocumentCount: 0,
      coverage: { complete: true },
    } as unknown as RepositoryLayoutMigrationPlan,
    cachedLifecycle: null,
    history: { events: [], complete: true },
  };
}

function event(
  type: string,
  seq: number,
  occurredAt: string,
  payload: Record<string, unknown>,
): EventEnvelope {
  return { type, seq, occurredAt, payload } as EventEnvelope;
}

afterEach(() => vi.unstubAllEnvs());

describe("health projection from recorded sources", () => {
  it.each(["missing", "revision_changed", "expired"])(
    "retains independent cycle safety evidence when evaluation is %s",
    (reason) => {
      const input = sources();
      if (reason === "missing") input.staleness = null;
      else if (reason === "revision_changed") input.staleness!.currentRevision = "b".repeat(40);
      else input.staleness!.evaluatedAt = "2026-10-01T00:00:00Z";
      input.freshnessCycle!.summary.firstSafetyPath = "AGENTS.md";
      expect(projectRepositoryHealth(input).measures.freshness).toMatchObject({
        coverage: "partial",
        value: {
          stale: null,
          evaluated: null,
          cycleStale: 74,
          safety: 1,
          firstSafetyPath: "AGENTS.md",
        },
      });
      input.freshnessCycle!.lastCycleAt = "2026-10-01T00:00:00Z";
      expect(projectRepositoryHealth(input).measures.freshness).toMatchObject({
        status: "unknown",
        value: null,
      });
    },
  );

  it.each(["2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", null])(
    "excludes stale or unobserved owner sources (%s) without asserting a total zero",
    (at) => {
      const input = sources();
      input.attention = createOperatingAttentionReport({
        projectId: "prj_health",
        workstream: null,
        workstreamFreshness: null,
        canonicalization: { coverage: "complete", candidates: [] },
        knowledgeLifecycle: { coverage: "cached", issues: [] },
        documentFreshness: {
          held: [healthFreshnessCandidate({})],
          applied: [],
          zeroSuccessHold: null,
          debt: [],
        },
        instructionCapture: {
          candidates: [],
          held: [],
          applied: { rules: [], totalCount: 0 },
          authorityBlocked: { since: "2026-10-01T00:00:00Z", queuedCount: 1 },
        },
        observedAt: healthNow,
      });
      input.captureObservedAt = at;
      input.freshnessCycle!.lastCycleAt = at;
      expect(projectRepositoryHealth(input).measures.ownerReview).toMatchObject({
        status: "unknown",
        value: null,
      });
      // A single valid upkeep item is insufficient to turn the missing owner sources into zero.
      input.attention = createOperatingAttentionReport({
        projectId: "prj_health",
        workstream: null,
        workstreamFreshness: null,
        canonicalization: { coverage: "complete", candidates: [] },
        knowledgeLifecycle: {
          coverage: "cached",
          issues: [{ code: "normalization_required", command: "lervo knowledge status" }],
        },
        observedAt: healthNow,
      });
      expect(projectRepositoryHealth(input).measures.ownerReview).toMatchObject({
        coverage: "partial",
        value: { count: null, confirmedCount: 0, upkeepCount: null },
      });
    },
  );

  it("counts the full owner set before limiting the retained batch", () => {
    const input = sources();
    const report = createOperatingAttentionReport({
      projectId: "prj_health",
      workstream: null,
      workstreamFreshness: null,
      canonicalization: { coverage: "complete", candidates: [] },
      knowledgeLifecycle: {
        coverage: "cached",
        issues: Array.from({ length: 300 }, (_, i) => ({
          code: "turn_approval_pending",
          command: `lervo workstream current --context ${i}`,
        })),
      },
      documentFreshness: { held: [], applied: [], zeroSuccessHold: null, debt: [] },
      instructionCapture: { candidates: [], held: [], applied: { rules: [], totalCount: 0 } },
      knowledgeConvergence: { owner: null, publication: null },
      observedAt: healthNow,
    });
    // ADR-0561: a stored pending_user_approval declaration is Lervo work, never owner review.
    expect(report.summary).toMatchObject({ userActionCount: 0, truncatedCount: 44 });
    input.attention = report;
    expect(projectRepositoryHealth(input).measures.ownerReview.value).toMatchObject({ count: 0 });
    // Owner work that remains for other effects counts the full set before the batch limit.
    const byKind = report.summary.byKind!;
    input.attention = {
      ...report,
      summary: {
        ...report.summary,
        userActionCount: 300,
        byKind: {
          ...byKind,
          knowledge_lifecycle: { ...byKind.knowledge_lifecycle!, userActionCount: 300 },
        },
      },
      items: report.items.map((item) => ({
        ...item,
        actionOwner: "user",
        requiresUserAction: true,
        attribution: { ...item.attribution!, actor: "owner", requiresUserAction: true },
      })),
    };
    expect(projectRepositoryHealth(input).measures.ownerReview.value).toMatchObject({
      count: 300,
      confirmedCount: 300,
      omitted: 268,
    });
    expect(projectRepositoryHealth(input).measures.ownerReview.value!.items).toHaveLength(32);
  });

  it("does not close a current stop or count Find events using future event timestamps", () => {
    const input = sources();
    input.history!.events = [
      event("repository.knowledge.stage.recorded", 1, "2026-10-31T01:00:00Z", {
        obligationId: "one",
        state: "waiting_authority",
      }),
      event("repository.knowledge.stage.recorded", 2, "2026-11-01T01:00:00Z", {
        obligationId: "one",
        state: "current",
      }),
      event("context.injected", 3, "2026-11-01T01:00:00Z", {}),
      event("context.referenced", 4, "2026-11-01T01:00:00Z", {}),
      event("terminal.context.prepared", 5, "2026-11-01T01:00:00Z", {}),
    ];
    expect(recordedConvergenceStops(input.history!, healthNow)).toEqual([
      { since: "2026-10-31T01:00:00Z", until: null, state: "waiting_authority", reason: null },
    ]);
    expect(projectRepositoryHealth(input).measures.find.value).toMatchObject({
      lastInjectedAt: null,
      referencedCount: 0,
      terminalPreparedCount: 0,
    });
  });
  it("keeps stale/evaluated/unevaluated counts separate from cycle summaries and missing lint", () => {
    const result = projectRepositoryHealth(sources());
    expect(result.measures.freshness.value).toMatchObject({
      stale: 71,
      evaluated: 186,
      unevaluated: 1504,
      cycleStale: 74,
      blocked: true,
    });
    expect(result.measures.brokenLinks).toMatchObject({
      status: "unknown",
      value: null,
      reason: "link_web_unavailable",
    });
    // ADR-0551: broken links and unlinked amendments are gaps; orphans ride along as counts.
    const linked = sources();
    linked.linkWeb = {
      observedAt: healthNow.toISOString(),
      brokenCount: 0,
      missingBacklinkCount: 0,
      orphanCount: 5,
    };
    expect(projectRepositoryHealth(linked).measures.brokenLinks).toMatchObject({
      status: "within_target",
      value: { count: 0, missingBacklinkCount: 0, orphanCount: 5 },
    });
    linked.linkWeb.missingBacklinkCount = 2;
    const gap = projectRepositoryHealth(linked);
    expect(gap.measures.brokenLinks.status).toBe("gap");
    expect(formatRepositoryHealth(gap, healthNow)).toContain(
      "0 broken links, 2 amendments not linked back, 5 canonical documents unlinked",
    );
    linked.linkWeb.observedAt = "2026-10-01T00:00:00Z";
    expect(projectRepositoryHealth(linked).measures.brokenLinks.status).toBe("unknown");
    const missing = sources();
    missing.staleness = null;
    missing.maintenance = null;
    expect(projectRepositoryHealth(missing).measures.freshness.value).toMatchObject({
      stale: null,
      cycleStale: 74,
      safety: 1,
    });
    expect(projectRepositoryHealth(missing).measures.convergence.status).toBe("unknown");
    const stale = sources();
    stale.staleness!.evaluatedAt = "2026-10-01T00:00:00Z";
    expect(projectRepositoryHealth(stale).measures.freshness).toMatchObject({
      status: "gap",
      coverage: "partial",
      value: { stale: null, cycleStale: 74 },
    });
  });

  it("uses stage stop time rather than obligation age and leaves attention appearance unknown", () => {
    const input = sources();
    input.history!.events = [
      event("repository.knowledge.stage.recorded", 1, "2026-10-18T04:46:00Z", {
        obligationId: "one",
        state: "attention_required",
        failureCode: "document_directory_file_capacity_exceeded",
      }),
      event("repository.knowledge.stage.recorded", 2, "2026-10-20T04:46:00Z", {
        obligationId: "one",
        state: "attention_required",
        failureCode: "document_directory_file_capacity_exceeded",
      }),
    ];
    input.maintenance!.status.state = "attention_required";
    input.maintenance!.status.reason = "document_directory_file_capacity_exceeded";
    input.maintenance!.status.oldestAgeMilliseconds = 99_999_999_999;
    const result = projectRepositoryHealth(input);
    expect(result.measures.convergence.value).toMatchObject({
      since: "2026-10-18T04:46:00Z",
      owner: "resident",
      recovery: "none recorded (lervo knowledge convergence status)",
    });
    expect(result.measures.longestStop).toMatchObject({
      coverage: "partial",
      reason: "attention_appearance_unrecorded",
      value: { reportedAt: null, unreportedMilliseconds: null },
    });
    const stopped = recordedConvergenceStops(input.history!, healthNow);
    expect(stopped).toHaveLength(1);
  });

  it("reports a recorded stop's first owner-turn appearance and a never-shown stop", () => {
    const input = sources();
    input.history!.events = [
      event("repository.knowledge.stage.recorded", 1, "2026-10-18T04:46:00Z", {
        obligationId: "one",
        state: "attention_required",
        failureCode: "document_directory_file_capacity_exceeded",
      }),
    ];
    input.maintenance!.status.state = "attention_required";
    input.maintenance!.status.reason = "document_directory_file_capacity_exceeded";
    const age = healthNow.getTime() - Date.parse("2026-10-18T04:46:00Z");

    input.appearance = {
      schemaVersion: 1,
      recordingSince: "2026-10-01T00:00:00Z",
      stops: [
        {
          since: "2026-10-18T04:46:00Z",
          reason: "document_directory_file_capacity_exceeded",
          firstPreparedAt: "2026-10-18T05:46:00Z",
        },
      ],
    };
    expect(projectRepositoryHealth(input).measures.longestStop).toMatchObject({
      coverage: "complete",
      reason: null,
      value: { reportedAt: "2026-10-18T05:46:00Z", unreportedMilliseconds: 3_600_000 },
    });

    input.appearance = { ...input.appearance, stops: [] };
    expect(projectRepositoryHealth(input).measures.longestStop).toMatchObject({
      coverage: "complete",
      value: { reportedAt: null, unreportedMilliseconds: age },
    });

    // A stop at or before the pruned bound may have been shown, so it stays unknown.
    input.appearance = { ...input.appearance, prunedThrough: "2026-10-18T04:46:00Z" };
    expect(projectRepositoryHealth(input).measures.longestStop).toMatchObject({
      coverage: "partial",
      reason: "attention_appearance_unrecorded",
    });
    input.appearance = { ...input.appearance, prunedThrough: null };
    // A stop that began before recording may have appeared earlier, so it stays unknown.
    input.appearance = { ...input.appearance, recordingSince: "2026-10-19T00:00:00Z" };
    expect(projectRepositoryHealth(input).measures.longestStop).toMatchObject({
      coverage: "partial",
      reason: "attention_appearance_unrecorded",
    });
  });

  it("counts only the seven-day window and never calls bounded partial history zero", () => {
    const input = sources();
    input.history!.events = [
      event("context.referenced", 1, "2026-10-01T00:00:00Z", {}),
      event("context.injected", 2, "2026-10-30T00:00:00Z", {}),
      event("context.referenced", 3, "2026-10-31T01:00:00Z", {}),
      event("terminal.context.prepared", 4, "2026-10-31T01:10:00Z", {}),
    ];
    expect(projectRepositoryHealth(input).measures.find.value).toMatchObject({
      referencedCount: 1,
      terminalPreparedCount: 1,
      lastInjectedAt: "2026-10-30T00:00:00Z",
    });
    input.history!.complete = false;
    expect(projectRepositoryHealth(input).measures.find).toMatchObject({
      status: "unknown",
      value: null,
    });
    let calls = 0;
    const history = readHealthEventHistory(
      {
        list: ({ afterSeq = 0, limit = 1000 } = {}) => {
          calls++;
          return Array.from({ length: limit }, (_, i) =>
            event("context.referenced", afterSeq + i + 1, healthNow.toISOString(), {}),
          );
        },
      },
      healthNow,
    );
    expect(history.complete).toBe(false);
    expect(calls).toBeLessThanOrEqual(11);
  });

  it("proves Find from terminal turns that select and cite governing documents", () => {
    const input = sources();
    const turn = (seq: number, selectedCount: number, pathMentionCount: number) =>
      event("terminal.turn.observed", seq, "2026-10-30T00:00:00Z", {
        selectedCount,
        pathMentionCount,
      });
    input.history!.events = [turn(1, 0, 0), turn(2, 2, 0), turn(3, 0, 0)];
    const unproven = projectRepositoryHealth(input).measures.find;
    expect(unproven).toMatchObject({
      status: "gap",
      value: { turnCount: 3, selectedTurnCount: 1, pathMentionCount: 0 },
    });
    expect(formatRepositoryHealth(projectRepositoryHealth(input), healthNow)).toContain(
      "1/3 turns selected governing documents, 0 cited",
    );
    input.governance = { governedTurnCount: 4, missedTurnCount: 3 };
    expect(formatRepositoryHealth(projectRepositoryHealth(input), healthNow)).toContain(
      "3/4 changing turns missed governing canon",
    );
    input.history!.events.push(turn(4, 1, 1));
    expect(projectRepositoryHealth(input).measures.find).toMatchObject({
      status: "within_target",
      value: { turnCount: 4, selectedTurnCount: 2, pathMentionCount: 1 },
    });
  });

  it("keeps whole stage history but only the recent turn window, so volume stays complete", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const stored = [
      event("repository.knowledge.stage.recorded", 1, "2026-09-01T00:00:00Z", {
        obligationId: "one",
        state: "attention_required",
      }),
      ...Array.from({ length: 12_000 }, (_, index) =>
        event("terminal.context.prepared", index + 2, "2026-10-01T00:00:00Z", {}),
      ),
      event("terminal.turn.observed", 12_002, "2026-10-31T00:00:00Z", {}),
    ];
    const history = readHealthEventHistory(
      {
        list: ({ afterSeq = 0, limit = 1000 } = {}) =>
          stored.filter((item) => item.seq > afterSeq).slice(0, limit),
      },
      now,
    );
    expect(history.complete).toBe(true);
    expect(history.events.map((item) => item.type)).toEqual([
      "repository.knowledge.stage.recorded",
      "terminal.turn.observed",
    ]);
  });

  it("produces identical bytes for equal Mac and WSL source values without host paths or environment", () => {
    const mac = sources();
    mac.layout!.repositoryRoot = "/Users/owner/lervo";
    vi.stubEnv("HOSTNAME", "mac-owner");
    vi.stubEnv("WSL_DISTRO_NAME", "");
    const macBytes = JSON.stringify(projectRepositoryHealth(mac));
    const wsl = structuredClone(mac);
    wsl.layout!.repositoryRoot = "/mnt/c/repos/lervo";
    vi.stubEnv("HOSTNAME", "wsl-owner");
    vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu");
    expect(macBytes).toBe(JSON.stringify(projectRepositoryHealth(wsl)));
    expect(macBytes).not.toMatch(/\/Users\/|\/mnt\/|darwin|win32|linux/u);
  });
});

describe("convergence on a host that does not own it", () => {
  const ownerPeer = (observedAt: Date, residentState: string) => ({
    hostHash: `sha256:${"7".repeat(64)}`,
    hostLabel: "wsl",
    observedAt: observedAt.toISOString(),
    delegationState: "active",
    delegationExpiresAt: null,
    policy: "active",
    ownerRole: "owner",
    residentState,
  });
  const nonOwner = (peerState: string, peerAgeMs: number): HealthProjectionSources => {
    const input = sources();
    // The local record still shows a stop from an earlier ownership.
    input.maintenance = {
      observedAt: healthNow.toISOString(),
      status: {
        ...input.maintenance!.status,
        state: "attention_required",
        reason: "knowledge_compile_policy_violation",
      },
    };
    input.resident = { ...input.resident!, state: "waiting", reason: "waiting_owner:wsl" };
    input.ownerRole = { role: "waiting_owner", holderLabel: "wsl" };
    input.continuity = {
      peers: [ownerPeer(new Date(healthNow.getTime() - peerAgeMs), peerState)],
    } as unknown as HealthProjectionSources["continuity"];
    return input;
  };

  it("reports the owner's healthy state instead of its own earlier stop", () => {
    expect(
      projectRepositoryHealth(nonOwner("running", 5 * 60_000)).measures.convergence,
    ).toMatchObject({
      status: "within_target",
      value: { state: "owner_elsewhere", owner: "resident on wsl", since: null },
    });
  });

  it("matches the lease holder by host hash when labels repeat, and never trusts a missing state", () => {
    const input = nonOwner("attention", 5 * 60_000);
    const former = {
      ...(input.continuity!.peers[0] as object),
      hostHash: `sha256:${"1".repeat(64)}`,
      residentState: "running",
    };
    input.continuity = {
      peers: [former, ...input.continuity!.peers],
    } as unknown as HealthProjectionSources["continuity"];
    input.ownerRole = {
      role: "waiting_owner",
      holderLabel: "wsl",
      holderHostHash: `sha256:${"7".repeat(64)}`,
    };
    expect(projectRepositoryHealth(input).measures.convergence).toMatchObject({
      status: "gap",
      value: { reason: "owner_resident_attention" },
    });
    expect(
      projectRepositoryHealth(nonOwner(null as unknown as string, 5 * 60_000)).measures.convergence,
    ).toMatchObject({ status: "unknown", reason: "owner_resident_state_unrecorded" });
    expect(
      projectRepositoryHealth(nonOwner("stopped", 5 * 60_000)).measures.convergence,
    ).toMatchObject({ status: "gap", value: { reason: "owner_resident_stopped" } });
  });

  it("reports a stopped owner as a gap and an old owner observation as unknown", () => {
    expect(
      projectRepositoryHealth(nonOwner("attention", 5 * 60_000)).measures.convergence,
    ).toMatchObject({
      status: "gap",
      value: { reason: "owner_resident_attention" },
    });
    expect(
      projectRepositoryHealth(nonOwner("running", 3 * 60 * 60_000)).measures.convergence,
    ).toMatchObject({
      status: "unknown",
      reason: "owner_observation_missing_or_stale",
    });
  });
});
