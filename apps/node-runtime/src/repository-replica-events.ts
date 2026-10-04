import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import type { RepositoryReplicaOpenDivergence } from "@lervo/sync";

import type { RepositoryReplicaConflictPolicy } from "./repository-replica-merge.js";

const MAXIMUM_CONFLICT_PATH_DIGESTS = 16;

export type RepositoryReplicaReconciliationStrategy =
  "prefer_local" | "prefer_peer" | "merge" | "external";

/**
 * `unavailable` means the canonical event could not be written, for example because the local
 * repository has no Lervo project store; the coordinator retries while the divergence is open.
 */
export type RepositoryReplicaEventDisposition =
  { status: "recorded" | "duplicate" } | { status: "unavailable"; failureCode: string };

export interface RepositoryReplicaEventPort {
  recordDiverged(input: {
    repositoryRoot: string;
    divergence: RepositoryReplicaOpenDivergence;
    conflictPolicy: RepositoryReplicaConflictPolicy;
    occurredAt: string;
  }): Promise<RepositoryReplicaEventDisposition>;
  recordReconciled(input: {
    repositoryRoot: string;
    divergence: RepositoryReplicaOpenDivergence;
    conflictPolicy: RepositoryReplicaConflictPolicy;
    strategy: RepositoryReplicaReconciliationStrategy;
    resultSnapshotHash: string;
    occurredAt: string;
  }): Promise<RepositoryReplicaEventDisposition>;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function coordinate(prefix: "evt" | "run" | "ses", value: string): string {
  return `${prefix}_${sha256(`${prefix}:${value}`).slice("sha256:".length, "sha256:".length + 32)}`;
}

function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
    ? code
    : "repository_replica_event_unavailable";
}

/** Appends replica divergence events to the local repository's project event store. */
export class ProjectRepositoryReplicaEvents implements RepositoryReplicaEventPort {
  constructor(
    private readonly open: (root: string) => Promise<ProjectStorage> = openProjectStorage,
  ) {}

  recordDiverged(input: Parameters<RepositoryReplicaEventPort["recordDiverged"]>[0]) {
    const { divergence } = input;
    return this.append(input.repositoryRoot, divergence, input.conflictPolicy, {
      type: "repository.replica.diverged",
      occurredAt: input.occurredAt,
      payload: {
        replicaId: divergence.replicaId,
        divergenceId: divergence.divergenceId,
        localSnapshotHash: divergence.localSnapshotHash,
        peerSnapshotHash: divergence.peerSnapshotHash,
        commonSnapshotHash: divergence.commonSnapshotHash,
        conflictPathCount: divergence.conflictPathCount,
        conflictPathDigests: [...new Set(divergence.conflictPaths.map(sha256))].slice(
          0,
          MAXIMUM_CONFLICT_PATH_DIGESTS,
        ),
        occurredAt: input.occurredAt,
      },
    });
  }

  recordReconciled(input: Parameters<RepositoryReplicaEventPort["recordReconciled"]>[0]) {
    return this.append(input.repositoryRoot, input.divergence, input.conflictPolicy, {
      type: "repository.replica.reconciled",
      occurredAt: input.occurredAt,
      payload: {
        divergenceId: input.divergence.divergenceId,
        strategy: input.strategy,
        resultSnapshotHash: input.resultSnapshotHash,
        occurredAt: input.occurredAt,
      },
    });
  }

  private async append(
    repositoryRoot: string,
    divergence: RepositoryReplicaOpenDivergence,
    conflictPolicy: RepositoryReplicaConflictPolicy,
    event: {
      type: "repository.replica.diverged" | "repository.replica.reconciled";
      occurredAt: string;
      payload: Record<string, unknown>;
    },
  ): Promise<RepositoryReplicaEventDisposition> {
    let storage: ProjectStorage;
    try {
      storage = await this.open(repositoryRoot);
    } catch (error) {
      return { status: "unavailable", failureCode: failureCode(error) };
    }
    try {
      if ((storage.writableEventSchemaVersion ?? 1) < 4)
        return { status: "unavailable", failureCode: "event_schema_unsupported" };
      const eventId = coordinate("evt", `${event.type}:${divergence.divergenceId}`);
      if (storage.events.get(eventId) !== null) return { status: "duplicate" };
      const inserted = storage.events.transact((transaction) => {
        const result = transaction.append({
          eventId,
          projectId: storage.manifest.projectId,
          runId: coordinate("run", `repository-replica:${divergence.divergenceId}`),
          sessionId: coordinate("ses", `repository-replica:${divergence.replicaId}`),
          schemaVersion: 4,
          type: event.type,
          occurredAt: event.occurredAt,
          actor: { kind: "system" },
          policyVersion: sha256(
            canonicalJson({ kind: "repository_replica.conflict_policy", conflictPolicy }),
          ),
          payload: event.payload,
        });
        if (result.redactions.length !== 0)
          throw new Error("A repository replica event must not require redaction.");
        return result.inserted;
      });
      return { status: inserted ? "recorded" : "duplicate" };
    } catch (error) {
      return { status: "unavailable", failureCode: failureCode(error) };
    } finally {
      await storage.close();
    }
  }
}
