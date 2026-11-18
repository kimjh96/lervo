import { chooseFollowTarget } from "./host-follow-policy.js";
import { readFollowControl } from "./host-follow-state.js";
import type { HostReleaseSource, ReleaseListEntry } from "./host-release-source.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";

/**
 * ADR-0589: a pass that installs no release lists releases at most once per repository boundary,
 * and never within this long of the previous listing, so a pass of many short repositories costs
 * about one GitHub request a minute.
 */
export const FOLLOW_PASS_RELEASE_CHECK_MS = 60_000;

export interface FollowReleaseWatchInput {
  layout: HostUpgradeLayout;
  source: HostReleaseSource;
  activeVersion: string | null;
  failedTags: readonly string[];
  now: () => Date;
  /** The listing the cycle already made, which the first boundaries reuse. */
  listed: { releases: ReleaseListEntry[]; at: Date } | null;
  /**
   * A tag whose last install attempt is held without counting against it (`followHeldTag`). The
   * pass does not yield to it, so a pass that would stop again every cycle runs to its end.
   */
  heldTag: string | null;
}

/**
 * Install outcomes that leave the tag installable at the next poll without failing it: the
 * release is incomplete, the host needs the owner, the host upgrade lock is held, or the install
 * is retried. Yielding to such a tag could stop a pass at the same boundary every cycle.
 */
const heldInstallOutcomes = new Set([
  "waiting",
  "host_blocked",
  "busy",
  "install_retry",
  "install_abandoned",
]);

/** ADR-0589: the tag the last cycle tried to install and left held, or null. */
export function followHeldTag(
  lastOutcome: { outcome: string; tag: string | null } | null,
): string | null {
  return lastOutcome !== null && heldInstallOutcomes.has(lastOutcome.outcome)
    ? lastOutcome.tag
    : null;
}

/**
 * ADR-0589: the release a running non-release pass yields to. `installable` answers the tag the
 * follower would install now, as the poll would choose it, or null. It honours a pause or pin the
 * owner set during the pass, and a failed listing only means no release is known yet: the poll
 * keeps counting source failures. A held tag is left to the poll.
 */
export function followReleaseWatch(input: FollowReleaseWatchInput): {
  installable: () => Promise<string | null>;
} {
  let listed = input.listed;
  return {
    async installable() {
      const now = input.now();
      let current = listed;
      if (
        current === null ||
        now.getTime() - current.at.getTime() >= FOLLOW_PASS_RELEASE_CHECK_MS
      ) {
        const releases = await input.source.listReleases().catch(() => null);
        current = { releases: releases ?? current?.releases ?? [], at: now };
        listed = current;
      }
      const control = await readFollowControl(input.layout).catch(() => null);
      if (control === null || control.paused) return null;
      const target = chooseFollowTarget({
        releases: current.releases,
        activeVersion: input.activeVersion,
        failedTags: input.failedTags,
        pinnedTag: control.pinnedTag,
      });
      return target.kind === "install" && target.tag !== input.heldTag ? target.tag : null;
    },
  };
}
