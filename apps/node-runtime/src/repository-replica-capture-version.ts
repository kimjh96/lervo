/**
 * The capture semantics this runtime implements. Bump it whenever the same repository bytes can
 * produce a different snapshot, so a coordinator never compares snapshots across semantics
 * (ADR-0481). `v2` is ADR-0478: a tracked delegation's worktree bytes are captured.
 */
export const REPOSITORY_REPLICA_CAPTURE_VERSION = "lervo.repository-replica.capture.v2";

/**
 * The capture semantics a runtime that predates the `capture-version` peer action implements.
 * Such a runtime still restores the `HEAD` entry of a tracked convergence delegation (ADR-0478).
 */
export const LEGACY_REPOSITORY_REPLICA_CAPTURE_VERSION = "lervo.repository-replica.capture.v1";
