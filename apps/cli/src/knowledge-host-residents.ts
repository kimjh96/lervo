import { ensureHostTerminalRuntime } from "./terminal-runtime.js";
import { inspectEventWriterCoordinate } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import {
  acquireHostKnowledgeResidentLock,
  hostKnowledgeResidentLockPath,
  hostKnowledgeResidentStatusPath,
  knowledgeResidentHoldReason,
  startAutonomousKnowledgeWorker,
  startKnowledgeResidentHold,
  writeHostKnowledgeResidentStatus,
  type HostKnowledgeResidentLock,
  type HostResidentRepository,
} from "@lervo/repository-knowledge-runtime";

import {
  activateLocalEventWriter,
  type LocalEventWriterActivation,
} from "./event-writer-activation-stage.js";
import {
  createKnowledgeConvergenceContinuity,
  createKnowledgeConvergenceOwnership,
  createKnowledgePublisher,
  instructionCandidateTransport,
} from "./knowledge-convergence-ownership.js";
import {
  hostResidentCandidates,
  type ResidentProvider,
} from "./knowledge-host-resident-candidates.js";
import { prefetchRepositoryHealth } from "./repository-health-prefetch.js";

/** How often the host resident looks for newly registered or removed repositories. */
export const HOST_RESIDENT_SCAN_MILLISECONDS = 5 * 60_000;
/** How often the host status heartbeat is refreshed between scans. */
export const HOST_RESIDENT_HEARTBEAT_MILLISECONDS = 60_000;
/**
 * A held checkout retries automatic activation at most this often; between retries a scan only
 * reads the writer coordinate, so an activation done elsewhere is picked up on the next scan.
 */
export const HOST_RESIDENT_ACTIVATION_RETRY_MILLISECONDS = 30 * 60_000;

interface RunningResident {
  storage: ProjectStorage;
  stop: () => Promise<void>;
}

interface HeldResident {
  reason: "event_schema_outdated";
  detail: string | null;
  retryAt: number;
  stop: () => Promise<void>;
}

/**
 * ADR-0469 host resident, with ADR-0470 admission: one process keeps a knowledge resident for
 * every repository this host knows that is not served by its own Node. A checkout whose event
 * writer is older than the resident's schema is activated automatically when it is local-only;
 * otherwise it is held with a heartbeat that names the cause, and retried on every scan. Only one
 * host resident serves a host; another one waits on standby.
 */
export function startHostKnowledgeResidents(input: {
  provider: ResidentProvider | null;
  launch?: "service" | "manual";
  onCycle?: (root: string, result: unknown) => void;
  onFailure: (root: string, error: unknown) => void;
  scanMilliseconds?: number;
  heartbeatMilliseconds?: number;
  activate?: (root: string) => Promise<LocalEventWriterActivation>;
  now?: () => Date;
  materializeRuntime?: () => Promise<unknown>;
}): () => Promise<void> {
  const workerId = `cli-host-${process.pid}`;
  const activate = input.activate ?? ((root: string) => activateLocalEventWriter(root));
  const now = input.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const statusPath = hostKnowledgeResidentStatusPath();
  const lockPath = hostKnowledgeResidentLockPath();
  const residents = new Map<string, RunningResident>();
  const held = new Map<string, HeldResident>();
  let observed: HostResidentRepository[] = [];
  const scanProgress: {
    startedAt: string | null;
    completedAt: string | null;
    repositoryRoot: string | null;
  } = {
    startedAt: null,
    completedAt: null,
    repositoryRoot: null,
  };
  let lock: HostKnowledgeResidentLock | null = null;
  let stopped = false;
  let scanning: Promise<void> = Promise.resolve();

  const writeStatus = async () => {
    if (statusPath === null || stopped) return;
    await writeHostKnowledgeResidentStatus(statusPath, {
      schemaVersion: 1,
      pid: process.pid,
      startedAt,
      heartbeatAt: now().toISOString(),
      launch: input.launch ?? "manual",
      role: lock?.acquired === true ? "active" : "standby",
      repositories: observed,
      scan: { ...scanProgress },
    }).catch((error: unknown) => input.onFailure("", error));
  };

  const startResident = (root: string, storage: ProjectStorage, provider: ResidentProvider) => {
    const stop = startAutonomousKnowledgeWorker({
      storage,
      workerId,
      provider,
      ownership: createKnowledgeConvergenceOwnership(storage, provider),
      continuity: createKnowledgeConvergenceContinuity(storage),
      instructionCandidateTransport,
      publish: createKnowledgePublisher(storage.paths.repositoryRoot),
      refreshHealth: () => prefetchRepositoryHealth(root),
      onCycle: (result) => input.onCycle?.(root, result),
      onFailure: (error) => input.onFailure(root, error),
    });
    residents.set(root, { storage, stop });
  };

  const hold = (root: string, detail: string | null) => {
    const retryAt = now().getTime() + HOST_RESIDENT_ACTIVATION_RETRY_MILLISECONDS;
    const current = held.get(root);
    if (current !== undefined) {
      current.detail = detail;
      current.retryAt = retryAt;
      return;
    }
    held.set(root, {
      reason: "event_schema_outdated",
      detail,
      retryAt,
      stop: startKnowledgeResidentHold({
        repositoryRoot: root,
        workerId,
        reason: "event_schema_outdated",
        onFailure: (error) => input.onFailure(root, error),
      }),
    });
  };

  const openAdmitted = async (root: string): Promise<ProjectStorage | null> => {
    const storage = await openProjectStorage(root);
    if (knowledgeResidentHoldReason(storage.writableEventSchemaVersion) === null) return storage;
    await storage.close();
    return null;
  };

  /** Opens the checkout; returns an admitted storage, or null after recording a hold. */
  const admit = async (root: string): Promise<ProjectStorage | null> => {
    const previous = held.get(root);
    if (previous !== undefined && now().getTime() < previous.retryAt) {
      const coordinate = await inspectEventWriterCoordinate(root).catch(() => null);
      if (knowledgeResidentHoldReason(coordinate?.coordinate.selectedEventSchemaVersion) !== null)
        return null;
    }
    const admitted = await openAdmitted(root);
    if (admitted !== null) return admitted;
    const activation = await activate(root);
    if (activation.status !== "held") {
      const activated = await openAdmitted(root);
      if (activated !== null) return activated;
    }
    hold(root, activation.status === "held" ? activation.code : null);
    return null;
  };

  const release = async (root: string) => {
    const resident = residents.get(root);
    residents.delete(root);
    if (resident !== undefined) await resident.stop().finally(() => resident.storage.close());
    const hold = held.get(root);
    held.delete(root);
    await hold?.stop();
  };

  const scan = async () => {
    scanProgress.startedAt = now().toISOString();
    scanProgress.repositoryRoot = null;
    if (lock?.acquired !== true) {
      lock =
        lockPath === null
          ? { acquired: false, holderPid: null }
          : await acquireHostKnowledgeResidentLock(lockPath);
      if (!lock.acquired) {
        observed = [];
        await writeStatus();
        return;
      }
    }
    await (
      input.materializeRuntime ?? (() => ensureHostTerminalRuntime({ authority: "repair" }))
    )().catch((error: unknown) => input.onFailure("", error));
    const candidates = await hostResidentCandidates(input.provider);
    for (const root of new Set([...residents.keys(), ...held.keys()]))
      if (!candidates.wanted.has(root)) await release(root);
    for (const [root, provider] of candidates.wanted) {
      if (stopped || residents.has(root)) continue;
      scanProgress.repositoryRoot = root;
      try {
        const storage = await admit(root);
        if (storage === null) continue;
        await held.get(root)?.stop();
        held.delete(root);
        startResident(root, storage, provider);
      } catch (error) {
        input.onFailure(root, error);
      }
    }
    observed = [
      ...[...candidates.wanted.keys()].map((root): HostResidentRepository => {
        const hold = held.get(root);
        return hold === undefined
          ? { repositoryRoot: root, state: "serving", reason: null, detail: null }
          : { repositoryRoot: root, state: "held", reason: hold.reason, detail: hold.detail };
      }),
      ...candidates.nodeServed.map((root): HostResidentRepository => ({
        repositoryRoot: root,
        state: "node_served",
        reason: null,
        detail: null,
      })),
      ...candidates.notEnrolled.map((root): HostResidentRepository => ({
        repositoryRoot: root,
        state: "not_enrolled",
        reason: null,
        detail: null,
      })),
    ].sort((left, right) => (left.repositoryRoot < right.repositoryRoot ? -1 : 1));
    scanProgress.completedAt = now().toISOString();
    scanProgress.repositoryRoot = null;
    await writeStatus();
  };
  const rescan = () => {
    scanning = scanning.then(scan).catch((error: unknown) => input.onFailure("", error));
  };
  rescan();
  const scanTimer = setInterval(rescan, input.scanMilliseconds ?? HOST_RESIDENT_SCAN_MILLISECONDS);
  const heartbeatTimer = setInterval(
    () => void writeStatus(),
    input.heartbeatMilliseconds ?? HOST_RESIDENT_HEARTBEAT_MILLISECONDS,
  );
  return async () => {
    clearInterval(scanTimer);
    clearInterval(heartbeatTimer);
    stopped = true;
    await scanning;
    await Promise.all([...new Set([...residents.keys(), ...held.keys()])].map(release));
    if (lock?.acquired === true) await lock.release();
  };
}
