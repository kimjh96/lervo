import { describe, expect, it } from "vitest";

import {
  BLOCKED_REPOSITORY_RECHECK_MS,
  FOLLOW_BACKOFF_LIMIT_MS,
  FOLLOW_POLL_INTERVAL_MS,
  chooseFollowTarget,
  classifyInstallFailure,
  classifyRepositoryFailure,
  followPollDelay,
  repositoryPassDue,
  scheduleRepositoryRetry,
} from "../src/host-follow-policy.js";

const release = (tag: string, overrides: { draft?: boolean; prerelease?: boolean } = {}) => ({
  tag,
  draft: overrides.draft ?? false,
  prerelease: overrides.prerelease ?? false,
});

describe("chooseFollowTarget", () => {
  const releases = [
    release("v1.3.0", { draft: true }),
    release("v1.2.10"),
    release("v1.2.9"),
    release("v1.2.11", { prerelease: true }),
    release("nightly"),
  ];

  it("installs only the newest published release, skipping intermediate ones", () => {
    expect(
      chooseFollowTarget({ releases, activeVersion: "1.2.1", failedTags: [], pinnedTag: null }),
    ).toEqual({ kind: "install", tag: "v1.2.10", version: "1.2.10" });
  });

  it("stays idle when current, never downgrades, and never falls back past a failed release", () => {
    expect(
      chooseFollowTarget({ releases, activeVersion: "1.2.10", failedTags: [], pinnedTag: null }),
    ).toMatchObject({ kind: "idle", reason: "current" });
    expect(
      chooseFollowTarget({ releases, activeVersion: "2.0.0", failedTags: [], pinnedTag: null }),
    ).toMatchObject({ kind: "idle", reason: "current" });
    expect(
      chooseFollowTarget({
        releases,
        activeVersion: "1.2.1",
        failedTags: ["v1.2.10"],
        pinnedTag: null,
      }),
    ).toEqual({ kind: "idle", reason: "release_failed_on_host", tag: "v1.2.10" });
    expect(
      chooseFollowTarget({ releases: [], activeVersion: null, failedTags: [], pinnedTag: null }),
    ).toMatchObject({ kind: "idle", reason: "no_published_release" });
  });

  it("holds a pinned host at its published pin", () => {
    expect(
      chooseFollowTarget({ releases, activeVersion: "1.2.1", failedTags: [], pinnedTag: "v1.2.9" }),
    ).toEqual({ kind: "install", tag: "v1.2.9", version: "1.2.9" });
    expect(
      chooseFollowTarget({ releases, activeVersion: "1.2.9", failedTags: [], pinnedTag: "v1.2.9" }),
    ).toMatchObject({ kind: "idle", reason: "pinned_release_reached" });
    expect(
      chooseFollowTarget({
        releases,
        activeVersion: "1.2.1",
        failedTags: [],
        pinnedTag: "v1.2.11",
      }),
    ).toMatchObject({ kind: "idle", reason: "pinned_release_unavailable" });
  });
});

describe("followPollDelay", () => {
  it("keeps every host within ±20% of five minutes", () => {
    expect(followPollDelay(0, () => 0)).toBe(Math.round(FOLLOW_POLL_INTERVAL_MS * 0.8));
    expect(followPollDelay(0, () => 1)).toBe(Math.round(FOLLOW_POLL_INTERVAL_MS * 1.2));
    expect(followPollDelay(0, () => 0.5)).toBe(FOLLOW_POLL_INTERVAL_MS);
    for (let sample = 0; sample < 200; sample += 1) {
      const delay = followPollDelay(0, Math.random);
      expect(delay).toBeGreaterThanOrEqual(Math.round(FOLLOW_POLL_INTERVAL_MS * 0.8));
      expect(delay).toBeLessThanOrEqual(Math.round(FOLLOW_POLL_INTERVAL_MS * 1.2));
    }
  });

  it("doubles on release-source failures up to one hour", () => {
    expect(followPollDelay(1, () => 0.5)).toBe(2 * FOLLOW_POLL_INTERVAL_MS);
    expect(followPollDelay(2, () => 0.5)).toBe(4 * FOLLOW_POLL_INTERVAL_MS);
    expect(followPollDelay(50, () => 0.5)).toBe(FOLLOW_BACKOFF_LIMIT_MS);
    expect(followPollDelay(50, () => 1)).toBe(Math.round(FOLLOW_BACKOFF_LIMIT_MS * 1.2));
  });
});

describe("failure classification", () => {
  it("retries transient install failures and fails the tag for anything unexplained", () => {
    expect(classifyInstallFailure("host_release_unavailable")).toBe("transient");
    expect(classifyInstallFailure("host_upgrade_in_progress")).toBe("transient");
    expect(classifyInstallFailure("host_release_assets_incomplete")).toBe("waiting");
    expect(classifyInstallFailure("host_upgrade_link_not_managed")).toBe("host_blocked");
    expect(classifyInstallFailure("host_upgrade_health_failed")).toBe("release_failed");
    expect(classifyInstallFailure("release_subjects_digest_mismatch")).toBe("release_failed");
    expect(classifyInstallFailure("something_new")).toBe("release_failed");
  });

  it("treats Node readiness and an unreadable CLI as host failures and content as blocked", () => {
    expect(classifyRepositoryFailure("node_fleet_readiness_timeout")).toBe("host_failure");
    expect(classifyRepositoryFailure("host_follow_repository_upgrade_unreadable")).toBe(
      "host_failure",
    );
    expect(classifyRepositoryFailure("upgrade_owner_approval_required")).toBe("blocked");
    expect(classifyRepositoryFailure("node_fleet_config_invalid")).toBe("failed");
    // ADR-0577: a lost admission is retried with the same CLI; it says nothing about the host.
    expect(classifyRepositoryFailure("knowledge_cycle_admission_lost")).toBe("failed");
  });

  it("makes a repository pass due for an unsettled activation or another CLI", () => {
    const pass = {
      cliTarget: "/a/dist/bin.js",
      version: "1.0.0",
      finishedAt: "t",
      outcome: "current" as const,
      repositories: [],
    };
    expect(
      repositoryPassDue({ inFlight: null, lastPass: null }, { target: "/a/dist/bin.js" }),
    ).toBe(true);
    expect(
      repositoryPassDue({ inFlight: null, lastPass: pass }, { target: "/a/dist/bin.js" }),
    ).toBe(false);
    expect(
      repositoryPassDue({ inFlight: null, lastPass: pass }, { target: "/b/dist/bin.js" }),
    ).toBe(true);
    expect(
      repositoryPassDue(
        {
          inFlight: {
            tag: "v1.0.0",
            activationId: "hact_x",
            startedAt: "t",
            rollback: null,
            interruptions: 0,
          },
          lastPass: pass,
        },
        { target: "/a/dist/bin.js" },
      ),
    ).toBe(true);
  });
});

describe("scheduleRepositoryRetry", () => {
  const entry = (outcome: "current" | "blocked" | "failed" | "host_failure") => ({
    repositoryRoot: "/r",
    outcome,
    status: null,
    code: null,
    rounds: 1,
    appliedStages: [],
    pendingStages: [],
    planId: null,
    waitMs: null,
    applyMs: null,
    elapsedMs: 0,
  });
  const at = new Date("2026-11-17T00:00:00.000Z");
  const minutes = (value: number) => new Date(at.getTime() + value * 60_000).toISOString();

  it("retries failed repositories after 10, 20, and 40 minutes, then stops", () => {
    let previous: ReturnType<typeof scheduleRepositoryRetry> | undefined;
    const schedule: (string | null)[] = [];
    for (let run = 0; run < 4; run += 1) {
      previous = scheduleRepositoryRetry(entry("failed"), previous, at);
      schedule.push(previous.nextAttemptAt);
    }
    expect(schedule).toEqual([minutes(10), minutes(20), minutes(40), null]);
    expect(scheduleRepositoryRetry(entry("current"), previous, at)).toMatchObject({
      attempts: 0,
      nextAttemptAt: null,
    });
  });

  it("re-plans blocked repositories hourly and never retries a host failure", () => {
    expect(scheduleRepositoryRetry(entry("blocked"), undefined, at).nextAttemptAt).toBe(
      new Date(at.getTime() + BLOCKED_REPOSITORY_RECHECK_MS).toISOString(),
    );
    expect(scheduleRepositoryRetry(entry("host_failure"), undefined, at).nextAttemptAt).toBeNull();
  });
});
