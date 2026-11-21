import { resolve } from "node:path";

import { workforceSourcePaths } from "@lervo/agent-workforce";
import { WORKSTREAM_BRANCH_BINDINGS_PATH } from "@lervo/repository-knowledge/workstream";
import { watchFiles } from "@lervo/repository-knowledge-runtime";
import type { OutcomeSupervisionCycleResult } from "@lervo/orchestrator";
import type { EventStore } from "@lervo/storage-contract";

import { createSupervisionChangeLoop } from "./supervision-change-loop.js";
import { SupervisionObservationGate } from "./supervision-observation-gate.js";
import type { SupervisionPeerCatalog } from "./supervision-peer-catalog.js";
import type { SupervisionResultDelivery } from "./supervision-result-delivery.js";
import type { NodeSupervisionStore } from "./supervision-store.js";
import { changeSignalAttention } from "./change-signal-attention.js";

/**
 * ADR-0602: files that change what supervision may do without an event: the current workstream
 * and branch bindings (an inactive workstream waits for them or an event), and every workforce
 * source an agent or assignment listing reads (B7). Each change invalidates the observation gate.
 */
export function watchSupervisionSources(repositoryRoot: string, hint: () => void): () => void {
  let stopped = false;
  const workstreams = watchFiles(
    [
      resolve(repositoryRoot, ".lervo/state/workstreams/current.json"),
      resolve(repositoryRoot, WORKSTREAM_BRANCH_BINDINGS_PATH),
    ],
    hint,
  );
  let workforce: { stop(): void } | null = null;
  workforceSourcePaths(repositoryRoot).then(
    (paths) => {
      if (stopped) return;
      workforce = watchFiles(paths.files, hint, () => undefined, paths.trees);
      // A source changed while its paths were resolved is seen by the next observation.
      hint();
    },
    // Unresolvable sources leave the observation gate's own age bound in charge.
    () => undefined,
  );
  return () => {
    stopped = true;
    workstreams.stop();
    workforce?.stop();
  };
}

type LoopOptions = Pick<Parameters<typeof createSupervisionChangeLoop>[0], "onFailure" | "onCycle">;

/**
 * Decides when one supervision wakes and whether a wake-up needs a full observation. Event-store
 * change signals and every duty deadline wake the loop; the observation gate skips a wake-up that would
 * only repeat an unchanged observation.
 */
export function createNodeSupervisionWakeSchedule(input: {
  repositoryRoot: string;
  runCycle(): Promise<OutcomeSupervisionCycleResult>;
  store: Pick<NodeSupervisionStore, "subscribe" | "auditHistory">;
  peers: Pick<SupervisionPeerCatalog, "subscribe" | "nextAuditAt">;
  delivery: Pick<SupervisionResultDelivery, "nextRetryAt"> | null;
  events: Pick<EventStore, "latest">;
  nextCheckAt(): number | null;
  mandateExpiresAt(): number | null;
  now(): string;
}): (options: LoopOptions) => ReturnType<typeof createSupervisionChangeLoop> {
  const { store, peers, delivery } = input;
  const dutyDeadlines = () => [
    input.mandateExpiresAt(),
    input.nextCheckAt(),
    peers.nextAuditAt(),
    delivery?.nextRetryAt() ?? null,
  ];
  let observedPaths: ReturnType<typeof workforceSourcePaths> | undefined;
  const gate = new SupervisionObservationGate({
    head: () => {
      const latest = input.events.latest();
      return latest === null ? null : { seq: latest.seq, eventHash: latest.eventHash };
    },
    // The coordination home only moves with the checkout; a full observation still runs at least
    // every fifteen minutes.
    paths: () =>
      (observedPaths ??= workforceSourcePaths(input.repositoryRoot).catch((error: unknown) => {
        observedPaths = undefined;
        throw error;
      })),
    deadlines: dutyDeadlines,
    auditHistory: () => store.auditHistory(),
  });
  return (options) =>
    createSupervisionChangeLoop({
      ...options,
      onChangeSignal: changeSignalAttention(input.repositoryRoot),
      runCycle: () => gate.run(input.runCycle),
      subscribe: (notify) => {
        const hint = () => {
          gate.invalidate();
          notify();
        };
        const stopLocal = store.subscribe(hint);
        const stopPeers = peers.subscribe(hint);
        const stopFiles = watchSupervisionSources(input.repositoryRoot, hint);
        return () => {
          stopLocal();
          stopPeers();
          stopFiles();
        };
      },
      nextAuthorityCheckAt: () => {
        // A lapsed mandate wakes nothing; its expiry is observed by the cycle it ended.
        const mandateExpiresAt = input.mandateExpiresAt();
        const candidates = [
          mandateExpiresAt !== null && mandateExpiresAt > Date.parse(input.now())
            ? mandateExpiresAt
            : null,
          input.nextCheckAt(),
          peers.nextAuditAt(),
          delivery?.nextRetryAt() ?? null,
        ].filter((value): value is number => value !== null);
        return candidates.length === 0 ? null : Math.min(...candidates);
      },
    });
}
