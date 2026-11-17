import type { ActiveCli } from "./host-follow-runtime.js";
import type { HostFollowState, RepositoryUpgradeOutcome } from "./host-follow-state.js";
import type { ReleaseListEntry } from "./host-release-source.js";

/**
 * ADR-0575 follower policy: which release a host installs, when it polls next, and what each
 * failure means. Pure decisions; the cycle performs the effects.
 */
export const FOLLOW_POLL_INTERVAL_MS = 5 * 60_000;
export const FOLLOW_POLL_JITTER_RATIO = 0.2;
export const FOLLOW_BACKOFF_LIMIT_MS = 60 * 60_000;

const releaseTagPattern = /^v(\d+)\.(\d+)\.(\d+)$/u;

/** The `<major>.<minor>.<patch>` of a `v`-prefixed release tag, or null for any other tag. */
export function releaseTagVersion(tag: string): string | null {
  return releaseTagPattern.test(tag) ? tag.slice(1) : null;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export type FollowTarget =
  | { kind: "install"; tag: string; version: string }
  | {
      kind: "idle";
      reason:
        | "current"
        | "no_published_release"
        | "release_failed_on_host"
        | "pinned_release_unavailable"
        | "pinned_release_reached";
      tag: string | null;
    };

/** Published `v<major>.<minor>.<patch>` releases, newest version first. */
export function publishedReleases(
  releases: readonly ReleaseListEntry[],
): { tag: string; version: string }[] {
  return releases
    .filter((release) => !release.draft && !release.prerelease)
    .flatMap((release) => {
      const version = releaseTagVersion(release.tag);
      return version === null ? [] : [{ tag: release.tag, version }];
    })
    .sort((left, right) => compareVersions(right.version, left.version));
}

/**
 * Only the newest published release counts, so a host that missed several releases skips the
 * ones in between. A failed newest release is never replaced by an older one. A pin holds the
 * host at that release: it is installed when newer than the active CLI, and nothing newer is.
 * Following never downgrades; going back is `--rollback`.
 */
export function chooseFollowTarget(input: {
  releases: readonly ReleaseListEntry[];
  activeVersion: string | null;
  failedTags: readonly string[];
  pinnedTag: string | null;
}): FollowTarget {
  const published = publishedReleases(input.releases);
  const candidate =
    input.pinnedTag === null
      ? published[0]
      : published.find((release) => release.tag === input.pinnedTag);
  if (candidate === undefined)
    return input.pinnedTag === null
      ? { kind: "idle", reason: "no_published_release", tag: null }
      : { kind: "idle", reason: "pinned_release_unavailable", tag: input.pinnedTag };
  if (input.activeVersion !== null && compareVersions(candidate.version, input.activeVersion) <= 0)
    return {
      kind: "idle",
      reason: input.pinnedTag === null ? "current" : "pinned_release_reached",
      tag: candidate.tag,
    };
  if (input.failedTags.includes(candidate.tag))
    return { kind: "idle", reason: "release_failed_on_host", tag: candidate.tag };
  return { kind: "install", tag: candidate.tag, version: candidate.version };
}

/**
 * Every host polls on the same interval with its own random jitter, so hosts do not query GitHub
 * in lockstep; consecutive release-source failures double the base delay up to one hour.
 */
export function followPollDelay(consecutiveSourceFailures: number, random: () => number): number {
  const base = Math.min(
    FOLLOW_POLL_INTERVAL_MS * 2 ** Math.min(Math.max(consecutiveSourceFailures, 0), 8),
    FOLLOW_BACKOFF_LIMIT_MS,
  );
  const factor = 1 + FOLLOW_POLL_JITTER_RATIO * (2 * Math.min(Math.max(random(), 0), 1) - 1);
  return Math.round(base * factor);
}

/**
 * What a failed install means for the tag. `transient` retries on the next poll, `waiting` retries
 * because the release is not complete yet, `host_blocked` is a host problem the owner fixes, and
 * `release_failed` marks the tag so it is never installed automatically again. Unknown codes fail
 * the tag, because retrying an unexplained failure every few minutes would never converge.
 */
export type InstallFailureKind = "transient" | "waiting" | "host_blocked" | "release_failed";

const transientInstallCodes = new Set([
  "host_release_unavailable",
  "host_upgrade_install_failed",
  "host_upgrade_in_progress",
]);
const waitingInstallCodes = new Set([
  "host_release_assets_incomplete",
  "host_release_not_published",
]);
const hostBlockedInstallCodes = new Set([
  "host_upgrade_link_not_managed",
  "host_upgrade_journal_invalid",
  "host_upgrade_platform_unsupported",
]);

export function classifyInstallFailure(code: string): InstallFailureKind {
  if (transientInstallCodes.has(code)) return "transient";
  if (waitingInstallCodes.has(code)) return "waiting";
  if (hostBlockedInstallCodes.has(code)) return "host_blocked";
  return "release_failed";
}

/**
 * Failures of `lervo upgrade` that mean the new CLI does not run on this host: the Node it
 * restarted did not become ready, or the command produced no readable result at all. Content
 * blocks, such as lint, a layout decision, or a stage waiting for owner approval, are reported
 * and never roll the host back.
 */
const hostFailureCodes = new Set([
  "node_fleet_readiness_timeout",
  "node_fleet_service_unavailable",
  "node_fleet_recovery_failed",
  "node_fleet_apply_failed",
  "host_follow_repository_upgrade_unreadable",
]);
const contentBlockCodes = new Set(["upgrade_owner_approval_required"]);

export function classifyRepositoryFailure(code: string): RepositoryUpgradeOutcome {
  if (hostFailureCodes.has(code)) return "host_failure";
  if (contentBlockCodes.has(code)) return "blocked";
  return "failed";
}

/**
 * A repository pass is due while the follower's own activation has not settled, and whenever the
 * `lervo` link names another CLI than the last pass ran: after a handover, a manual activation, a
 * rollback, or on the follower's first cycle.
 */
export function repositoryPassDue(
  state: Pick<HostFollowState, "inFlight" | "lastPass">,
  active: Pick<ActiveCli, "target">,
): boolean {
  return (
    state.inFlight !== null ||
    (active.target !== null && state.lastPass?.cliTarget !== active.target)
  );
}
