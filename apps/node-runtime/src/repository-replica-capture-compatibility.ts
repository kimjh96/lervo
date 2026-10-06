import { REPOSITORY_REPLICA_CAPTURE_VERSION } from "./repository-replica-capture-version.js";
import { RepositoryReplicaStageError } from "./repository-replica-failure.js";
const CAPTURE_VERSION = /^lervo\.repository-replica\.capture\.v[1-9][0-9]{0,3}$/u;
/** A proven-compatible peer is checked again after this long, so a redeployed peer is noticed. */
const COMPATIBLE_FOR_MS = 15 * 60_000;

export interface RepositoryReplicaCaptureVersionPort {
  /** The capture semantics this side's snapshots use; absent only in test doubles. */
  captureVersion?(): Promise<string>;
}

export function parseRepositoryReplicaCaptureVersion(value: unknown): string {
  const version = (value as { schemaVersion?: unknown; captureVersion?: unknown } | null)
    ?.captureVersion;
  if (
    (value as { schemaVersion?: unknown } | null)?.schemaVersion !== 1 ||
    typeof version !== "string" ||
    !CAPTURE_VERSION.test(version)
  )
    throw new RepositoryReplicaStageError(
      "repository_replica_capture_version_invalid",
      "protocol",
      "The peer reported an invalid repository replica capture version.",
    );
  return version;
}

/**
 * ADR-0483: two sides may compare snapshots only when both capture with the same semantics. A
 * peer runtime with older semantics computes a different snapshot for the same bytes, so a change
 * only it can see would look unchanged forever. The cycle fails instead of reporting `current`.
 */
export class RepositoryReplicaCaptureCompatibility {
  private provenUntil = 0;

  constructor(private readonly now: () => number) {}

  async assert(input: {
    local: RepositoryReplicaCaptureVersionPort;
    peer: RepositoryReplicaCaptureVersionPort;
  }): Promise<void> {
    if (this.now() < this.provenUntil) return;
    const [local, peer] = await Promise.all([
      input.local.captureVersion?.() ?? REPOSITORY_REPLICA_CAPTURE_VERSION,
      input.peer.captureVersion?.() ?? REPOSITORY_REPLICA_CAPTURE_VERSION,
    ]);
    if (local !== peer)
      throw new RepositoryReplicaStageError(
        "repository_replica_capture_incompatible",
        "protocol",
        `The local side captures with ${local} and the peer with ${peer}; point peer.remoteRuntimesDirectory at the peer's runtimes directory, or update peer.remoteRuntimeExecutable.`,
      );
    this.provenUntil = this.now() + COMPATIBLE_FOR_MS;
  }
}
