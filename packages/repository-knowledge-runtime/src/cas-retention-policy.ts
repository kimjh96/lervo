import { replayKnowledgeConvergence } from "@lervo/repository-knowledge";
import type { EventEnvelope } from "@lervo/schemas";
import { visitEventSnapshot, type OutboxStore } from "@lervo/storage-contract";

const CONVERGENCE = new Set([
  "repository.knowledge.baseline.requested",
  "repository.knowledge.stage.recorded",
  "repository.knowledge.convergence.recorded",
]);
const ARTIFACT_FIELDS = [
  "inputArtifactHash",
  "resultArtifactHash",
  "dependencyHash",
  "evidenceHash",
];

/** Conservative reference extraction also recognizes hashes nested in private subsystem records. */
export function casReferences(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/(?:sha256:|lervo-cas:\/\/sha256\/)([a-f0-9]{64})/gu)].map(
        (match) => match[1]!,
      ),
    ),
  ];
}

/** Bounds the distinct references the inventory retains, never the length of history (ADR-0554). */
const maximumRetainedReferences = 200_000;

export interface CasRetentionRoots {
  head: string | null;
  candidates: Map<string, number>;
  reachable: Set<string>;
  lastReference: Map<string, number>;
}

/**
 * All non-convergence event payloads remain roots, regardless of their lifecycle or age. Every
 * payload can name an artifact, so the scan streams the verified snapshot through the observed
 * head and retains only references.
 */
export function convergenceArtifactRoots(events: OutboxStore): CasRetentionRoots {
  const observed = events.latest();
  const head = observed?.eventHash ?? null;
  replayKnowledgeConvergence(events);
  const candidates = new Map<string, number>();
  const reachable = new Set<string>();
  const lastReference = new Map<string, number>();
  const obligations = new Map<string, { settled: boolean; latest: string[]; all: string[] }>();
  let parked: string[] = [];
  const visit = (event: EventEnvelope) => {
    const refs = casReferences(JSON.stringify(event.payload));
    for (const hash of refs) lastReference.set(hash, event.seq);
    if (lastReference.size > maximumRetainedReferences)
      throw new Error("CAS event reference inventory exceeds its bound.");
    const root = () => {
      for (const hash of refs) reachable.add(hash);
    };
    if (!CONVERGENCE.has(event.type)) {
      root();
      return;
    }
    const id = event.payload.obligationId;
    if (typeof id !== "string") throw new Error("Convergence retention identity is invalid.");
    let row = obligations.get(id);
    if (!row) {
      row = { settled: false, latest: [], all: [] };
      obligations.set(id, row);
    }
    row.all.push(...refs);
    for (const field of ARTIFACT_FIELDS) {
      const value = event.payload[field];
      if (typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value)) {
        const at = Date.parse(event.occurredAt);
        if (!Number.isFinite(at)) throw new Error("Convergence retention time is invalid.");
        candidates.set(value.slice(7), Math.max(candidates.get(value.slice(7)) ?? 0, at));
      }
    }
    if (event.type === "repository.knowledge.stage.recorded") {
      if (event.payload.state !== "queued" && event.payload.state !== "running") row.latest = refs;
      // These proofs are historical consumers, not disposable stage diagnostics.
      if (event.payload.stage === "normalization_apply" && event.payload.state === "current")
        root();
      if (event.payload.failureCode === "knowledge_sources_parked") parked = refs;
    }
    if (event.type === "repository.knowledge.convergence.recorded") {
      row.settled = true;
      row.all = [];
      // historicalObligations reads every successful terminal lifecycle receipt.
      root();
    }
  };
  if (observed !== null)
    visitEventSnapshot({
      events,
      throughSeq: observed.seq,
      throughHash: observed.eventHash,
      visit,
    });
  for (const row of obligations.values())
    for (const hash of row.settled ? row.latest : row.all) reachable.add(hash);
  for (const hash of parked) reachable.add(hash);
  if ((events.latest()?.eventHash ?? null) !== head)
    throw new Error("The CAS reference event head changed.");
  return { head, candidates, reachable, lastReference };
}

export function reachableConvergenceArtifacts(
  roots: ReadonlySet<string>,
  edges: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const marked = new Set(roots);
  const pending = [...marked];
  while (pending.length) {
    for (const hash of edges.get(pending.pop()!) ?? []) {
      if (marked.has(hash)) continue;
      marked.add(hash);
      pending.push(hash);
    }
  }
  return marked;
}
