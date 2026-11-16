import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  REPOSITORY_REPLICA_PER_CALL_LAUNCHER,
  repositoryReplicaPeerLauncher,
  repositoryReplicaPerCallLauncherGuidance,
} from "@lervo/sync";

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
import {
  describeRepositoryReplicaFailure,
  isRepositoryReplicaPeerTransportFailure,
} from "./repository-replica-failure.js";
import type { RepositoryReplicaConflictPolicy } from "./repository-replica-merge.js";
import {
  replicaCycleOutcome,
  replicaFailureOutcome,
  type ReplicaReconcileOutcome,
} from "./repository-replica-recovery-backoff.js";
import { resolveSshTransport } from "./repository-replica-ssh-connection.js";
import { SshRepositoryReplicaPeer } from "./repository-replica-ssh-peer.js";
import {
  watchReplicaReconciliation,
  type ReplicaPeerBackoffState,
} from "./repository-replica-watch.js";

export interface RepositoryReplicaRunPorts {
  cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
  signal?: AbortSignal;
  now?: () => Date;
  platform?: NodeJS.Platform;
}

/** Private Lervo-managed SSH control sockets live beside the coordinator state file. */
export function repositoryReplicaSshControlDirectory(stateFile: string): string {
  return join(dirname(stateFile), "replica-ssh");
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
  const transport = await resolveSshTransport({
    ...config.peer,
    platform: ports.platform ?? process.platform,
    controlDirectory: repositoryReplicaSshControlDirectory(stateFile),
  });
  if (transport.reuse.mode === "unavailable" && transport.reuse.reason !== "client_not_openssh")
    ports.stderr(
      `Repository replica peer steps each open their own SSH connection (${transport.reuse.reason}).\n`,
    );
  const launcher = repositoryReplicaPeerLauncher(config.peer);
  const advisories = launcher === null ? [] : [REPOSITORY_REPLICA_PER_CALL_LAUNCHER];
  if (launcher !== null)
    ports.stderr(
      `${REPOSITORY_REPLICA_PER_CALL_LAUNCHER}: ${repositoryReplicaPerCallLauncherGuidance(launcher)}\n`,
    );
  const peer = new SshRepositoryReplicaPeer({
    ...peerOptions,
    arguments: transport.arguments,
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
  let peerBackoff: RepositoryReplicaHealthSnapshot["peer"];
  let healthWrite = Promise.resolve();
  const publishHealth = () => {
    healthWrite = healthWrite
      .then(() =>
        writeHealth(
          healthPath,
          reporter.snapshot(now(), { recoveryIntervalMs, peer: peerBackoff, advisories }),
        ),
      )
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
    probePeer: async () => {
      try {
        await peer.captureVersion();
        return true;
      } catch (error) {
        return !isRepositoryReplicaPeerTransportFailure(
          describeRepositoryReplicaFailure(error, "protocol"),
        );
      }
    },
    onPeerBackoff: (state: ReplicaPeerBackoffState) => {
      const previous = peerBackoff;
      peerBackoff =
        state.retryAt === null
          ? undefined
          : {
              status: "backing_off",
              consecutiveFailures: state.consecutiveFailures,
              retryAt: new Date(state.retryAt).toISOString(),
            };
      if (peerBackoff?.retryAt === previous?.retryAt) return;
      if (peerBackoff === undefined) ports.stdout("Repository replica peer answered again.\n");
      else
        ports.stderr(
          `Repository replica peer is unreachable; the next attempt is at ${peerBackoff.retryAt} (${peerBackoff.consecutiveFailures} consecutive).\n`,
        );
      void publishHealth();
    },
    reconcile: async (repository, { trigger }) => {
      let outcome: ReplicaReconcileOutcome;
      try {
        const result = await coordinator.reconcile({ ...repository, trigger });
        if (result.status === "divergent") unhealthy = true;
        outcome = replicaCycleOutcome(result);
        emit(reporter.observeResult(result));
      } catch (error) {
        unhealthy = true;
        const [failure, receiptRecorded] =
          error instanceof RepositoryReplicaCycleError
            ? [error.failure, error.receiptRecorded]
            : [describeRepositoryReplicaFailure(error, "snapshot"), false];
        emit(reporter.observeFailure(repository.replicaId, failure, receiptRecorded));
        outcome = replicaFailureOutcome(failure, reporter.failureStreak(repository.replicaId));
      }
      await publishHealth();
      return outcome;
    },
  });
  await healthWrite;
  return unhealthy && !options.watch ? 2 : 0;
}
