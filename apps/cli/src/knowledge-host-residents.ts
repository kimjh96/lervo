import { statSync } from "node:fs";
import { resolve } from "node:path";

import { applyStoredInstructionCandidates } from "./durable-instruction-auto-apply.js";
import { ensureHostTerminalRuntime } from "./terminal-runtime.js";
import { inspectEventWriterCoordinate, resolveProjectPaths } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { terminalHookRuntimeStorePath } from "@lervo/repository-knowledge";
import {
  defaultNodeFleetRegistryPath,
  defaultRepositoryRegistryPath,
} from "@lervo/repository-registry";
import {
  acquireHostKnowledgeResidentLock,
  CONVERGENCE_DELEGATION_PATH,
  defaultConvergenceContinuityPolicyPath,
  watchFiles,
  hostKnowledgeResidentLockPath,
  hostKnowledgeResidentStatusPath,
  knowledgeResidentHoldReason,
  startAutonomousKnowledgeWorker,
  startKnowledgeResidentHold,
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
  knowledgeHubChangeTransport,
} from "./knowledge-convergence-ownership.js";
import {
  hostResidentCandidates,
  type ResidentProvider,
} from "./knowledge-host-resident-candidates.js";
import { prefetchResidentProjections } from "./resident-projection-prefetch.js";
import { hostResidentStatusWriter } from "./knowledge-host-status-writer.js";
import { watchStandbyHolder } from "./knowledge-host-standby-watch.js";
import { activationRetryAt } from "./knowledge-host-activation-retry.js";
import { refreshRelationWebWithCatalog } from "./relation-web-catalog.js";

/**
 * ADR-0602: a standby host resident retries the host lock when the holder's presence closes. Only
 * a holder of an earlier release, which records no presence, is retried after this. An active
 * one never rescans on a timer; it rescans when a registry, policy, delegation or the terminal
 * runtime pointer changes, and at a held checkout's retry time. Its status is written only on
 * change, and its process presence proves it runs.
 */
export const HOST_RESIDENT_SCAN_MILLISECONDS = 5 * 60_000;

interface RunningResident {
  storage: ProjectStorage;
  stop: () => Promise<void>;
}

interface HeldResident {
  reason: "event_schema_outdated";
  detail: string | null;
  retryAt: number;
  attempts: number;
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
  /** `cost` holds counts, scope names, and timings only; it carries no path or argument. */
  onCycle?: (root: string, result: unknown, cost: unknown) => void;
  onFailure: (root: string, error: unknown) => void;
  scanMilliseconds?: number;
  activate?: (root: string) => Promise<LocalEventWriterActivation>;
  now?: () => Date;
  materializeRuntime?: () => Promise<unknown>;
  /** Test seam: the terminal runtime store whose pointer a rescan repairs. */
  runtimeStore?: string;
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
  const status = hostResidentStatusWriter({
    path: statusPath,
    startedAt,
    launch: input.launch ?? "manual",
    now,
    onFailure: (error) => input.onFailure("", error),
  });
  const presenceToken = status.presenceToken;
  const writeStatus = () =>
    stopped
      ? Promise.resolve()
      : status.write({
          role: lock?.acquired === true ? "active" : "standby",
          repositories: observed,
          scan: { ...scanProgress },
        });

  const startResident = (root: string, storage: ProjectStorage, provider: ResidentProvider) => {
    // A stale web keeps its previous catalog; the lifecycle never treats it as a failure.
    void refreshRelationWebWithCatalog(root, now()).catch(() => undefined);
    const stop = startAutonomousKnowledgeWorker({
      storage,
      workerId,
      provider,
      ownership: createKnowledgeConvergenceOwnership(storage, provider),
      continuity: createKnowledgeConvergenceContinuity(storage),
      instructionCandidateTransport,
      hubChanges: knowledgeHubChangeTransport,
      applyOwnerStatedInstructions: () =>
        applyStoredInstructionCandidates({
          repositoryRoot: storage.paths.repositoryRoot,
          now: () => new Date(),
        }),
      publish: createKnowledgePublisher(storage.paths.repositoryRoot),
      refreshHealth: () => prefetchResidentProjections(root),
      onCycle: (result, cost) => input.onCycle?.(root, result, cost),
      onFailure: (error) => input.onFailure(root, error),
    });
    residents.set(root, { storage, stop });
  };

  const hold = (root: string, detail: string | null) => {
    const current = held.get(root);
    const attempts = (current?.attempts ?? 0) + 1;
    // ADR-0602: a blocker with a local signal (the writer coordinate, the runtime pointer, the
    // fleet registry, all watched) waits for it; one only a remote reader can clear (a Node or
    // Hub on an earlier release) is retried with backoff from the activation retry bound.
    const retryAt = activationRetryAt(detail, attempts, now().getTime());
    if (current !== undefined) {
      current.detail = detail;
      current.retryAt = retryAt;
      current.attempts = attempts;
      return;
    }
    held.set(root, {
      reason: "event_schema_outdated",
      detail,
      retryAt,
      attempts,
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
    // A blocker with a local signal is re-attempted on every rescan, which only a change starts.
    if (
      previous !== undefined &&
      Number.isFinite(previous.retryAt) &&
      now().getTime() < previous.retryAt
    ) {
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
      const token = await presenceToken;
      lock =
        lockPath === null
          ? { acquired: false, holderPid: null, holderPresence: null }
          : await acquireHostKnowledgeResidentLock(lockPath, process.pid, undefined, token);
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
  // ADR-0602: the inputs a scan reads are watched, and the next scan is armed only for a held
  // checkout's retry time or, on standby, the lock retry. The watch stays armed across scans, so
  // a change while a scan runs queues the next one; a new path set is armed before the old one
  // is closed, and a newly watched file changed since its scan began rescans at once.
  let inputs: { stop(): void } | null = null;
  let watched = new Set<string>();
  let next: ReturnType<typeof setTimeout> | null = null;
  let scanStartedAt = 0;
  const watchInputs = () => {
    const paths = [
      ...[
        defaultRepositoryRegistryPath,
        defaultNodeFleetRegistryPath,
        () => defaultConvergenceContinuityPolicyPath(),
        () => resolve(input.runtimeStore ?? terminalHookRuntimeStorePath(), "current.json"),
        () => lockPath,
      ].flatMap((path) => {
        try {
          const value = path();
          return value === null ? [] : [value];
        } catch {
          return [];
        }
      }),
      ...[...residents.keys(), ...held.keys()].map((root) =>
        resolve(root, CONVERGENCE_DELEGATION_PATH),
      ),
      // ADR-0602: a held checkout's writer coordinate, which an activation elsewhere rewrites.
      ...[...held.keys()].map((root) => resolveProjectPaths(root).eventContract),
    ];
    const wanted = new Set(paths);
    if (wanted.size === watched.size && [...wanted].every((path) => watched.has(path))) return;
    const added = [...wanted].filter((path) => !watched.has(path));
    const armed = watchFiles([...wanted], rescan, (error) => input.onFailure("", error));
    inputs?.stop();
    inputs = armed;
    watched = wanted;
    // A file first watched now may have changed after the scan read it.
    if (
      added.some((path) => {
        try {
          return statSync(path).mtimeMs >= scanStartedAt;
        } catch {
          return false;
        }
      })
    )
      rescan();
  };
  let holderExit: (() => void) | null = null;
  const armNext = () => {
    if (next !== null) clearTimeout(next);
    next = null;
    holderExit?.();
    holderExit = null;
    if (stopped) return;
    // ADR-0602: on standby, the holder's exit or release is the signal to try the lock again.
    if (lock?.acquired === false && lock.holderPresence !== null) {
      holderExit = watchStandbyHolder({
        holderPresence: lock.holderPresence,
        provider: input.provider,
        onExit: rescan,
        onFailure: (error) => input.onFailure("", error),
      });
      return;
    }
    const retries = [...held.values()]
      .map((entry) => entry.retryAt)
      .filter((at) => Number.isFinite(at));
    const at =
      lock?.acquired !== true
        ? now().getTime() + (input.scanMilliseconds ?? HOST_RESIDENT_SCAN_MILLISECONDS)
        : retries.length === 0
          ? null
          : Math.min(...retries);
    if (at !== null) next = setTimeout(rescan, Math.max(0, at - now().getTime()));
  };
  let queued = false;
  function rescan() {
    // Changes that arrive before the queued scan starts are covered by it.
    if (queued) return;
    queued = true;
    scanning = scanning
      .then(() => {
        queued = false;
        scanStartedAt = Date.now() - 1_000;
        return scan();
      })
      .catch((error: unknown) => input.onFailure("", error))
      .finally(() => {
        if (stopped) return;
        watchInputs();
        armNext();
      });
  }
  watchInputs();
  rescan();
  return async () => {
    stopped = true;
    inputs?.stop();
    if (next !== null) clearTimeout(next);
    holderExit?.();
    await scanning;
    await Promise.all([...new Set([...residents.keys(), ...held.keys()])].map(release));
    if (lock?.acquired === true) await lock.release();
    status.release();
  };
}
