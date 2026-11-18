import type { HostFollowPass, HostFollowState } from "./host-follow-state.js";
import type { HostReleaseSource } from "./host-release-source.js";
import type { RepositoryUpgradeRunner } from "./host-repository-upgrade-runner.js";
import type { HostUpgradeDependencies } from "./host-upgrade.js";

/** ADR-0575: the ports one follow cycle runs with. */
export interface HostFollowCycleDependencies {
  /** The ADR-0571 host upgrade ports; the follower installs and rolls back through them. */
  upgrade: HostUpgradeDependencies;
  source: HostReleaseSource;
  /** Roots of every repository registered on this host. */
  listRepositories: () => Promise<string[]>;
  runRepositoryUpgrade: RepositoryUpgradeRunner;
  /** The physical package root this process runs, or null outside an installed CLI. */
  runningInstallRoot: () => Promise<string | null>;
  /** Aborted when the service manager stops the follower; the cycle then settles nothing. */
  signal?: AbortSignal | undefined;
}

export type HostFollowCycleOutcome =
  | "paused"
  | "handover"
  | "interrupted"
  | "current"
  | "no_published_release"
  | "release_failed_on_host"
  | "pinned_release_unavailable"
  | "pinned_release_reached"
  | "source_unavailable"
  | "waiting"
  | "busy"
  | "install_retry"
  | "install_abandoned"
  | "host_blocked"
  | "release_failed"
  | "rolled_back"
  | "rollback_pending"
  | "rollback_failed"
  | "in_flight_superseded"
  | "upgraded"
  | "repositories_upgraded"
  | "repositories_retried";

export interface HostFollowCycleResult {
  outcome: HostFollowCycleOutcome;
  tag: string | null;
  code: string | null;
  activationId: string | null;
  pass: HostFollowPass | null;
  /** The process must exit so the service manager restarts it on the CLI the link runs now. */
  handover: boolean;
  /**
   * ADR-0589: the pass that installed no release and ran in this cycle before the install it
   * reports; `yielded` when a newer release stopped it at a repository boundary. Null otherwise.
   */
  precededBy: {
    outcome: "repositories_retried" | "repositories_upgraded";
    yielded: boolean;
  } | null;
  consecutiveSourceFailures: number;
  /** The poll delay's backoff level: release-source failures or failed installs in a row. */
  backoff: number;
}

/** What one step of a cycle decided, before the cycle records it. */
export type HostFollowStep = Partial<
  Omit<HostFollowCycleResult, "outcome" | "consecutiveSourceFailures" | "backoff">
> & { outcome: HostFollowCycleOutcome };

export interface HostFollowStepResult {
  state: HostFollowState;
  step: HostFollowStep;
}
