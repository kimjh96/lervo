import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { readRepositoryHold, repositoryReleaseCommand } from "@lervo/repository-knowledge-runtime";

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
import { noticeReplicaBackup } from "./repository-replica-notice.js";
import { restoreRepositoryReplicaSide } from "./repository-replica-restore.js";
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
 * replica; a conflict resolves through the configured side preference after a backup (ADR-0561).
 */
export async function runRepositoryReplicaCoordinator(
  config: RepositoryReplicaCoordinatorConfig,
  ports: RepositoryReplicaRunPorts,
  options: {
    watch: boolean;
    only?: { replicaId: string };
    /** The coordinator configuration's path, named in each backup notice's undo command. */
    config?: string;
    /** ADR-0561 undo: restore one saved losing side instead of reconciling. */
    restore?: { side: "local" | "peer"; branch: string };
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
  const local = new LocalRepositoryReplicaPeer();
  const configPath = options.config === undefined ? undefined : resolve(ports.cwd, options.config);
  if (options.restore !== undefined)
    return restoreRepositoryReplicaSide({
      repository: repositories[0]!,
      restore: options.restore,
      local,
      peer,
      ports,
      now,
    });
  const coordinator = new RepositoryReplicaCoordinator({
    stateFile,
    local,
    peer,
    now,
    noticeBackup: (input) =>
      noticeReplicaBackup({
        ...input,
        ...(configPath === undefined ? {} : { configPath }),
        now: now(),
      }),
  });
  const reporter = new RepositoryReplicaCycleReporter(options.watch, configPath);
  const emit = (lines: RepositoryReplicaReportLines) => {
    for (const line of lines.stdout) ports.stdout(`${line}\n`);
    for (const line of lines.stderr) ports.stderr(`${line}\n`);
  };
  let unhealthy = false;
  const heldReported = new Set<string>();
  let recoveryIntervalMs: number | undefined;
  let peerBackoff: RepositoryReplicaHealthSnapshot["peer"];
  let watchBackoff: RepositoryReplicaHealthSnapshot["watch"];
  let healthWrite = Promise.resolve();
  const publishHealth = () => {
    healthWrite = healthWrite
      .then(() =>
        writeHealth(
          healthPath,
          reporter.snapshot(now(), {
            recoveryIntervalMs,
            peer: peerBackoff,
            watch: watchBackoff,
            advisories,
          }),
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
    onWatchBackoff: (state) => {
      watchBackoff =
        state === null
          ? undefined
          : {
              status: "unavailable",
              source: state.source,
              consecutiveFailures: state.consecutiveFailures,
              retryAt: new Date(state.retryAt).toISOString(),
            };
      if (state === null) ports.stdout("Repository replica change sources are armed again.\n");
      else
        ports.stderr(
          `Repository replica ${state.source} change source is down; it is re-armed at ${watchBackoff!.retryAt} (${state.consecutiveFailures} consecutive).\n`,
        );
      void publishHealth();
    },
    reconcile: async (repository, { trigger }) => {
      // ADR-0561: while the owner holds the local repository, no transfer or conflict resolution
      // changes either side; the replica resumes when the owner releases the hold.
      if ((await readRepositoryHold(repository.localRoot)) !== null) {
        if (!heldReported.has(repository.replicaId))
          ports.stdout(
            `Repository replica ${repository.replicaId} is held by the owner; nothing is transferred until ${repositoryReleaseCommand(repository.localRoot)}.\n`,
          );
        heldReported.add(repository.replicaId);
        return "held";
      }
      let outcome: ReplicaReconcileOutcome;
      try {
        const result = await coordinator.reconcile({ ...repository, trigger });
        // ADR-0561: a hold on the peer's host stops the replica the same way as one here.
        if (result.status === "held") {
          if (!heldReported.has(repository.replicaId))
            ports.stdout(
              `Repository replica ${repository.replicaId} is held by the owner on the ${result.heldSides.join(" and ")} host; nothing is transferred until lervo repository release runs there.\n`,
            );
          heldReported.add(repository.replicaId);
          return "held";
        }
        heldReported.delete(repository.replicaId);
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
