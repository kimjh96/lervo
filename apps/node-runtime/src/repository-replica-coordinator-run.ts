import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  DEFAULT_IDLE_RECOVERY_CEILING_MS,
  remoteRuntimePayload,
  type RepositoryReplicaCoordinatorConfig,
} from "./repository-replica-config.js";
import {
  RepositoryReplicaCoordinator,
  RepositoryReplicaCycleError,
} from "./repository-replica-coordinator.js";
import { LocalRepositoryReplicaPeer } from "./repository-replica-local-peer.js";
import {
  RepositoryReplicaCycleReporter,
  type RepositoryReplicaHealthSnapshot,
  type RepositoryReplicaReportLines,
} from "./repository-replica-cycle-report.js";
import { describeRepositoryReplicaFailure } from "./repository-replica-failure.js";
import type { RepositoryReplicaConflictPolicy } from "./repository-replica-merge.js";
import type { ReplicaReconcileOutcome } from "./repository-replica-recovery-backoff.js";
import { SshRepositoryReplicaPeer } from "./repository-replica-ssh-peer.js";
import { watchReplicaReconciliation } from "./repository-replica-watch.js";

export interface RepositoryReplicaRunPorts {
  cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
  signal?: AbortSignal;
  now?: () => Date;
}

/** The coordinator health file sits beside its state file. */
export function repositoryReplicaHealthPath(stateFile: string): string {
  return `${stateFile.replace(/\.json$/u, "")}.health.json`;
}

async function writeHealth(path: string, snapshot: RepositoryReplicaHealthSnapshot) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.next`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/**
 * Runs reconciliation for the configured repositories. `only` restricts a one-shot run to one
 * replica and may override its conflict policy, which is how a held divergence is resolved.
 */
export async function runRepositoryReplicaCoordinator(
  config: RepositoryReplicaCoordinatorConfig,
  ports: RepositoryReplicaRunPorts,
  options: {
    watch: boolean;
    only?: { replicaId: string; conflictPolicy?: RepositoryReplicaConflictPolicy };
  },
): Promise<number> {
  const now = ports.now ?? (() => new Date());
  const stateFile = resolve(ports.cwd, config.stateFile);
  const healthPath = repositoryReplicaHealthPath(stateFile);
  const repositories = config.repositories
    .filter((item) => options.only === undefined || item.replicaId === options.only.replicaId)
    .map((item) => ({
      ...item,
      localRoot: resolve(ports.cwd, item.localRoot),
      ...(options.only?.conflictPolicy === undefined
        ? {}
        : { conflictPolicy: options.only.conflictPolicy }),
    }));
  if (repositories.length === 0)
    throw new Error("The requested repository replica is not configured.");
  const { remoteRuntimesDirectory: _directory, ...peerOptions } = config.peer;
  const peer = new SshRepositoryReplicaPeer({
    ...peerOptions,
    remoteRuntimeExecutable: remoteRuntimePayload(config.peer),
  });
  const coordinator = new RepositoryReplicaCoordinator({
    stateFile,
    local: new LocalRepositoryReplicaPeer(),
    peer,
    now,
  });
  const reporter = new RepositoryReplicaCycleReporter(options.watch);
  const emit = (lines: RepositoryReplicaReportLines) => {
    for (const line of lines.stdout) ports.stdout(`${line}\n`);
    for (const line of lines.stderr) ports.stderr(`${line}\n`);
  };
  let unhealthy = false;
  let recoveryIntervalMs: number | undefined;
  let healthWrite = Promise.resolve();
  const publishHealth = () => {
    healthWrite = healthWrite
      .then(() => writeHealth(healthPath, reporter.snapshot(now(), recoveryIntervalMs)))
      .catch((error: unknown) => {
        ports.stderr(
          `Repository replica health could not be written: ${error instanceof Error ? error.message : "unknown failure"}.\n`,
        );
      });
    return healthWrite;
  };
  await watchReplicaReconciliation({
    repositories,
    peer,
    fallbackIntervalMs: config.pollIntervalMs,
    idleRecoveryCeilingMs: config.idleRecoveryCeilingMs ?? DEFAULT_IDLE_RECOVERY_CEILING_MS,
    maximumConcurrency: config.maximumConcurrency ?? 4,
    watch: options.watch,
    peerWatch: config.peerWatch ?? true,
    ...(ports.signal === undefined ? {} : { signal: ports.signal }),
    onRecoveryInterval: (intervalMs) => {
      recoveryIntervalMs = intervalMs;
    },
    reconcile: async (repository, { trigger }) => {
      let outcome: ReplicaReconcileOutcome = "not_current";
      try {
        const result = await coordinator.reconcile({ ...repository, trigger });
        if (result.status === "divergent") unhealthy = true;
        if (result.status === "current") outcome = "current";
        emit(reporter.observeResult(result));
      } catch (error) {
        unhealthy = true;
        emit(
          error instanceof RepositoryReplicaCycleError
            ? reporter.observeFailure(repository.replicaId, error.failure, error.receiptRecorded)
            : reporter.observeFailure(
                repository.replicaId,
                describeRepositoryReplicaFailure(error, "snapshot"),
                false,
              ),
        );
      }
      await publishHealth();
      return outcome;
    },
  });
  await healthWrite;
  return unhealthy && !options.watch ? 2 : 0;
}
