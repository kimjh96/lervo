import type { ProjectStorage } from "@lervo/project-storage";
import {
  replayKnowledgeConvergence,
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import { waitingConvergenceStage } from "./stage-receipt.js";

/**
 * ADR-0479: every other source, stage, and projection finished, and only parked sources keep the
 * obligation from baseline currency. Each parked source names its exact bytes and review reasons.
 */
export const KNOWLEDGE_SOURCES_PARKED = "knowledge_sources_parked";

/** A rejected source is generated at most this many times for one exact content hash. */
export const MAXIMUM_SOURCE_GENERATION_ATTEMPTS = 3;

const MAXIMUM_PARKED_SOURCES = 256;
const MAXIMUM_REASONS = 4;
const MAXIMUM_REASON_LENGTH = 1_024;

/**
 * `lifecycle` (ADR-0483) parks one exact reviewed lifecycle plan: its `path` is the closed plan kind
 * and its `contentHash` the plan hash, so a changed plan is reviewed again.
 */
export type ParkedSourceStage = "canonical" | "normalization" | "lifecycle";

/**
 * `review_rejected`: bounded regeneration with the reviewer's reasons was exhausted.
 * `owner_decision`: the generator itself could not decide the source without the owner.
 */
export type ParkedSourceReason = "review_rejected" | "owner_decision";

export interface ParkedConvergenceSource {
  stage: ParkedSourceStage;
  path: string;
  contentHash: string;
  reason: ParkedSourceReason;
  attempts: number;
  reasons: string[];
}

/** Reviewer text stays private and bounded; it guides regeneration and names the parked cause. */
export function boundedReviewReasons(reasons: readonly string[]): string[] {
  return reasons
    .map((reason) => reason.trim().slice(0, MAXIMUM_REASON_LENGTH))
    .filter((reason) => reason.length > 0)
    .slice(-MAXIMUM_REASONS);
}

function parkedSource(value: unknown): ParkedConvergenceSource | null {
  const item = value as Partial<ParkedConvergenceSource> | null;
  if (
    item === null ||
    typeof item !== "object" ||
    (item.stage !== "canonical" && item.stage !== "normalization" && item.stage !== "lifecycle") ||
    typeof item.path !== "string" ||
    typeof item.contentHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(item.contentHash) ||
    (item.reason !== "review_rejected" && item.reason !== "owner_decision") ||
    !Number.isSafeInteger(item.attempts) ||
    !Array.isArray(item.reasons) ||
    !item.reasons.every((reason) => typeof reason === "string")
  )
    return null;
  return {
    stage: item.stage,
    path: item.path,
    contentHash: item.contentHash,
    reason: item.reason,
    attempts: item.attempts!,
    reasons: boundedReviewReasons(item.reasons),
  };
}

function key(item: Pick<ParkedConvergenceSource, "stage" | "path">): string {
  return `${item.stage}\0${item.path}`;
}

/** Sources this obligation parked, in stage data written by the stage that parked them. */
export function obligationParkedSources(state: KnowledgeConvergenceInput) {
  const value = state.stageData.parkedSources;
  return Array.isArray(value)
    ? value.map(parkedSource).filter((item) => item !== null)
    : ([] as ParkedConvergenceSource[]);
}

/** Merges by stage and path; a newer parking of the same source replaces the older one. */
export function mergeParkedSources(
  current: readonly ParkedConvergenceSource[],
  added: readonly ParkedConvergenceSource[],
): ParkedConvergenceSource[] {
  const merged = new Map(current.map((item) => [key(item), item]));
  for (const item of added) merged.set(key(item), item);
  return [...merged.values()]
    .sort((left, right) => key(left).localeCompare(key(right)))
    .slice(0, MAXIMUM_PARKED_SOURCES);
}

function parkedDependency(state: KnowledgeConvergenceInput, items: ParkedConvergenceSource[]) {
  return {
    schemaVersion: 1,
    kind: "parked_sources",
    code: KNOWLEDGE_SOURCES_PARKED,
    snapshotHash: state.snapshotHash,
    delegationHash: state.baseline.delegationHash,
    sources: items,
  };
}

async function readDependency(artifacts: ArtifactStore, hash: unknown) {
  if (typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash)) return null;
  try {
    const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
    if (sha256(bytes) !== hash) return null;
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as {
      code?: unknown;
      sources?: unknown;
    };
  } catch {
    return null;
  }
}

/**
 * The latest parked attention of an earlier obligation, still bound to the current bytes. A source
 * whose content changed is admitted again, so editing a parked document is the recovery.
 */
export async function carriedParkedSources(
  storage: { events: OutboxStore; artifacts: ArtifactStore },
  state: KnowledgeConvergenceInput,
): Promise<ParkedConvergenceSource[]> {
  let latest: string | null = null;
  for (let afterSeq = 0; ;) {
    const page = storage.events.list({
      afterSeq,
      limit: 1_000,
      types: ["repository.knowledge.stage.recorded"],
    });
    if (page.length === 0) break;
    for (const event of page) {
      afterSeq = event.seq;
      const payload = event.payload as { failureCode?: unknown; dependencyHash?: unknown };
      if (payload.failureCode === KNOWLEDGE_SOURCES_PARKED) latest = String(payload.dependencyHash);
    }
  }
  const dependency = await readDependency(storage.artifacts, latest);
  if (dependency?.code !== KNOWLEDGE_SOURCES_PARKED || !Array.isArray(dependency.sources))
    return [];
  const sources = new Map(state.baseline.sources.map((source) => [source.path, source]));
  return dependency.sources
    .map(parkedSource)
    .filter(
      (item): item is ParkedConvergenceSource =>
        item !== null &&
        (item.stage === "lifecycle" || sources.get(item.path)?.contentHash === item.contentHash),
    );
}

/** Parked sources of one stage that still bind the given current bytes. */
export function parkedPaths(
  items: readonly ParkedConvergenceSource[],
  stage: ParkedSourceStage,
  currentHash: (path: string) => string | undefined,
): Set<string> {
  return new Set(
    items
      .filter((item) => item.stage === stage && currentHash(item.path) === item.contentHash)
      .map((item) => item.path),
  );
}

/** The final, precise attention: everything else is done, and these exact sources remain. */
export async function parkedSourcesAttention(
  artifacts: ArtifactStore,
  state: KnowledgeConvergenceInput,
  items: ParkedConvergenceSource[],
): Promise<KnowledgeConvergenceStageResult> {
  return waitingConvergenceStage({
    artifacts,
    state,
    kind: "attention_required",
    reason: KNOWLEDGE_SOURCES_PARKED,
    dependency: parkedDependency(state, items),
  });
}

/**
 * Adds the parked sources of the active obligation's exact private dependency to an owner-local
 * status. Reviewer text stays private; the status names paths, causes, and attempts.
 */
export async function withParkedSourcesStatus(
  storage: Pick<ProjectStorage, "artifacts" | "events">,
  status: KnowledgeConvergenceStatus,
): Promise<KnowledgeConvergenceStatus> {
  if (status.reason !== KNOWLEDGE_SOURCES_PARKED) return status;
  const active = replayKnowledgeConvergence(storage.events).find((row) => row.outcome === null);
  const dependency = await readDependency(
    storage.artifacts,
    active?.latest?.payload.dependencyHash,
  );
  if (dependency?.code !== KNOWLEDGE_SOURCES_PARKED || !Array.isArray(dependency.sources))
    return status;
  const sources = dependency.sources.map(parkedSource).filter((item) => item !== null);
  return {
    ...status,
    parked: {
      count: sources.length,
      sources: sources.map(({ stage, path, reason, attempts }) => ({
        stage,
        path,
        reason,
        attempts,
      })),
    },
  };
}
