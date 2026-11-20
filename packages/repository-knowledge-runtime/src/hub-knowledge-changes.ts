import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";

import {
  CONVERGENCE_OWNER_HOST_PATH,
  readConvergenceOwnerHost,
  type ConvergenceOwnerHubCoordinates,
} from "./convergence-owner-host.js";
import { watchFiles } from "./resident-file-watch.js";

/**
 * ADR-0602: one held wait on the Hub's `knowledge` topic for this repository. It resolves with
 * the new cursor once the Hub's coordination state (owner lease holder, owner-rule candidates,
 * host records, definitions) changed through another host than `hostHash`, and rejects on a
 * transport failure or abort. A null cursor resolves at once with the current one.
 */
export interface KnowledgeHubChangePort {
  wait(input: {
    cursor: string | null;
    hostHash: string | null;
    signal: AbortSignal;
  }): Promise<{ cursor: string }>;
}

export type KnowledgeHubChangeTransport = (
  target: ConvergenceOwnerHubCoordinates & { projectId: string; repositoryIdentityHash: string },
) => Promise<KnowledgeHubChangePort>;

export type HubKnowledgeChangeIssue = "hub_knowledge_changes_unavailable" | "hub_upgrade_required";

export interface HubKnowledgeChangeWatch {
  /** The Hub cursor last observed; null while standalone or before the first answer. */
  token(): string | null;
  /**
   * Whether the Hub answers `knowledge` waits now, so it pushes coordination changes and keeps a
   * present holder's lease live; false while standalone, failing, or on a Hub older than ADR-0602.
   */
  pushing(): boolean;
  /** Settles at the first answer, the first failure, standalone, or the startup bound. */
  ready(): Promise<void>;
  stop(): Promise<void>;
}

/** A failed wait retries after base × 2^(failures − 1), up to the ceiling. */
export const HUB_KNOWLEDGE_CHANGE_RETRY_BASE_MILLISECONDS = 1_000;
export const HUB_KNOWLEDGE_CHANGE_RETRY_CEILING_MILLISECONDS = 5 * 60_000;
/** The longest a resident's first cycle waits for the first answer. */
export const HUB_KNOWLEDGE_CHANGE_READY_MILLISECONDS = 10_000;
/**
 * ADR-0602: a Hub older than this release refuses the `knowledge` wait. Until it is upgraded the
 * resident runs one full cycle at this cadence, the bound it had before, and asks the Hub again.
 */
export const HUB_KNOWLEDGE_LEGACY_CYCLE_MILLISECONDS = 60 * 60_000;

export function hubKnowledgeChangeRetryDelay(
  failures: number,
  base = HUB_KNOWLEDGE_CHANGE_RETRY_BASE_MILLISECONDS,
  ceiling = HUB_KNOWLEDGE_CHANGE_RETRY_CEILING_MILLISECONDS,
): number {
  return Math.min(ceiling, base * 2 ** Math.min(Math.max(0, failures - 1), 30));
}

/**
 * ADR-0602: keeps one held `knowledge` wait open for the repository's configured Hub and calls
 * `onChange` whenever the token changes after the first answer. The cursor survives a failure,
 * so a reconnection to the same Hub process holds again without a change, and one to a restarted
 * Hub yields a new token. The owner-host file is watched, so configured coordinates take effect
 * at once. A failed wait retries with exponential backoff and is reported through `onIssue`
 * until the next answer; nothing is armed while the wait is held.
 */
export function watchHubKnowledgeChanges(input: {
  storage: ProjectStorage;
  transport: KnowledgeHubChangeTransport | undefined;
  onChange: () => void;
  /** The failure that raised the issue rides along, so its cause can be shown. */
  onIssue?: (issue: HubKnowledgeChangeIssue | null, error?: unknown) => void;
  retry?: { baseMilliseconds: number; ceilingMilliseconds: number };
}): HubKnowledgeChangeWatch {
  const transport = input.transport;
  if (transport === undefined)
    return {
      token: () => null,
      pushing: () => false,
      ready: async () => undefined,
      stop: async () => undefined,
    };
  const root = input.storage.paths.repositoryRoot;
  const stopped = new AbortController();
  let token: string | null = null;
  let answered = false;
  let pushing = false;
  // The first answer after the startup bound gave up is a change: the first cycle ran without it.
  let readyTimedOut = false;
  let issue: HubKnowledgeChangeIssue | null = null;
  // Aborts the held wait or the retry sleep when the coordinates change.
  let interrupt = new AbortController();
  let markReady: () => void = () => undefined;
  const readiness = new Promise<void>((resolveReady) => {
    const bound = setTimeout(() => {
      readyTimedOut = true;
      resolveReady();
    }, HUB_KNOWLEDGE_CHANGE_READY_MILLISECONDS);
    bound.unref();
    markReady = () => {
      clearTimeout(bound);
      resolveReady();
    };
  });
  const report = (next: HubKnowledgeChangeIssue | null, error?: unknown) => {
    if (next === issue) return;
    issue = next;
    input.onIssue?.(next, error);
  };
  const observe = (next: string | null) => {
    const first = !answered;
    answered = true;
    markReady();
    if (next === token) return;
    token = next;
    if (!first || readyTimedOut) input.onChange();
  };
  const coordinates = watchFiles([resolve(root, CONVERGENCE_OWNER_HOST_PATH)], () =>
    interrupt.abort(),
  );
  const sleep = (milliseconds: number, signal: AbortSignal) =>
    new Promise<void>((resolveSleep) => {
      if (signal.aborted) return resolveSleep();
      const timer = Number.isFinite(milliseconds) ? setTimeout(finish, milliseconds) : null;
      signal.addEventListener("abort", finish, { once: true });
      function finish(): void {
        if (timer !== null) clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolveSleep();
      }
    });
  const run = async () => {
    let failures = 0;
    let cursor = null as { key: string; value: string } | null;
    while (!stopped.signal.aborted) {
      interrupt = new AbortController();
      const signal = AbortSignal.any([stopped.signal, interrupt.signal]);
      const host = await readConvergenceOwnerHost(root).catch(() => null);
      if (host?.config.coordination.mode !== "hub") {
        // Standalone: no Hub state exists, so only new coordinates can change that.
        report(null);
        observe(null);
        await sleep(Number.POSITIVE_INFINITY, signal);
        continue;
      }
      const hub = host.config.coordination.hub;
      const key = JSON.stringify([hub.baseUrl, hub.destinationId, hub.hubIdentityHash]);
      if (cursor?.key !== key) cursor = null;
      try {
        const port = await transport({
          ...hub,
          projectId: input.storage.manifest.projectId,
          repositoryIdentityHash: calculateProjectIdentityHash(input.storage.manifest),
        });
        while (!signal.aborted) {
          const answer = await port.wait({
            cursor: cursor?.value ?? null,
            hostHash: host.hostHash,
            signal,
          });
          cursor = { key, value: answer.cursor };
          failures = 0;
          pushing = true;
          report(null);
          observe(answer.cursor);
        }
      } catch (error) {
        pushing = false;
        if (signal.aborted) continue;
        const status = (error as { httpStatus?: unknown } | null)?.httpStatus;
        if (status === 400 || status === 404) {
          // A Hub older than ADR-0602: no pushes, so one full cycle per legacy cadence, through a
          // new token, until it is upgraded; asked again each time.
          report("hub_upgrade_required", error);
          observe(`legacy-${Date.now()}`);
          await sleep(HUB_KNOWLEDGE_LEGACY_CYCLE_MILLISECONDS, signal);
          continue;
        }
        failures += 1;
        // One lost connection is routine; a failure that repeats is attention.
        if (failures >= 2) report("hub_knowledge_changes_unavailable", error);
        markReady();
        await sleep(
          hubKnowledgeChangeRetryDelay(
            failures,
            input.retry?.baseMilliseconds,
            input.retry?.ceilingMilliseconds,
          ),
          signal,
        );
      }
    }
  };
  const running = run();
  return {
    token: () => token,
    pushing: () => pushing,
    ready: () => readiness,
    stop: async () => {
      stopped.abort();
      coordinates.stop();
      markReady();
      await running;
    },
  };
}
