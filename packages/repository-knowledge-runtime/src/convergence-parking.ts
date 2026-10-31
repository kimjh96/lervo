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
import { integrationTargetBlobHash, resolveIntegrationTarget } from "./integration-target-sync.js";
import { workingTreeHash } from "./integration-target-discard.js";
import { canonicalDocumentLayout } from "./canonical-layout.js";

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
 * `lifecycle` (ADR-0485) parks one exact reviewed lifecycle plan: its `path` is the closed plan kind
 * and its `contentHash` the plan hash, so a changed plan is reviewed again.
 */
export type ParkedSourceStage = "canonical" | "normalization" | "lifecycle";

/**
 * `review_rejected`: bounded regeneration with the reviewer's reasons was exhausted.
 * `owner_decision`: the generator itself could not decide the source without the owner.
 * `target_diverged` (ADR-0530): an approved draft's integration-target bytes differ from the
 * reviewed preimage, so integrating it would replace bytes nobody reviewed.
 * `layout_capacity_exceeded`: the approved batch cannot fit the projected document layout.
 */
export type ParkedSourceReason =
  "review_rejected" | "owner_decision" | "target_diverged" | "layout_capacity_exceeded";

/**
 * One draft target whose integration-ref bytes held a `target_diverged` source parked, with the
 * three byte states that decided it: the ref, `HEAD`, and the reviewed working-tree preimage.
 */
export interface ParkedTargetObservation {
  ref: string;
  path: string;
  observedHash: string | null;
  headHash: string | null;
  preimageHash: string | null;
}

export interface ParkedConvergenceSource {
  stage: ParkedSourceStage;
  path: string;
  contentHash: string;
  reason: ParkedSourceReason;
  attempts: number;
  reasons: string[];
  /** `target_diverged` only: the source is readmitted once any of these target bytes change. */
  targets?: ParkedTargetObservation[];
  /** Capacity policy, routes, and observed counts; source edits also readmit this source. */
  layoutCapacityHash?: string;
}

const PARKED_REASONS: ReadonlySet<unknown> = new Set([
  "review_rejected",
  "owner_decision",
  "target_diverged",
  "layout_capacity_exceeded",
]);
const MAXIMUM_PARKED_TARGETS = 8;

function parkedTargets(value: unknown): ParkedTargetObservation[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_PARKED_TARGETS)
    return null;
  const digest = (hash: unknown): hash is string | null =>
    hash === null || (typeof hash === "string" && /^sha256:[a-f0-9]{64}$/u.test(hash));
  const targets = value.map((item: Partial<ParkedTargetObservation> | null) =>
    item !== null &&
    typeof item === "object" &&
    typeof item.ref === "string" &&
    item.ref.startsWith("refs/") &&
    typeof item.path === "string" &&
    digest(item.observedHash) &&
    digest(item.headHash) &&
    digest(item.preimageHash)
      ? {
          ref: item.ref,
          path: item.path,
          observedHash: item.observedHash,
          headHash: item.headHash,
          preimageHash: item.preimageHash,
        }
      : null,
  );
  return targets.every((item) => item !== null) ? targets : null;
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
    !PARKED_REASONS.has(item.reason) ||
    !Number.isSafeInteger(item.attempts) ||
    !Array.isArray(item.reasons) ||
    !item.reasons.every((reason) => typeof reason === "string")
  )
    return null;
  const targets = item.reason === "target_diverged" ? parkedTargets(item.targets) : null;
  if (item.reason === "target_diverged" && targets === null) return null;
  if (
    item.reason === "layout_capacity_exceeded" &&
    (item.stage !== "canonical" ||
      typeof item.layoutCapacityHash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(item.layoutCapacityHash))
  )
    return null;
  return {
    stage: item.stage,
    path: item.path,
    contentHash: item.contentHash,
    reason: item.reason!,
    attempts: item.attempts!,
    reasons: boundedReviewReasons(item.reasons),
    ...(targets === null ? {} : { targets }),
    ...(item.reason === "layout_capacity_exceeded"
      ? { layoutCapacityHash: item.layoutCapacityHash }
      : {}),
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
 * A `target_diverged` source stays parked only while every recorded target keeps the ref, `HEAD`,
 * and working-tree bytes that parked it. A commit, a ref move, or an edit of the target readmits it.
 */
async function targetsUnchanged(
  repositoryRoot: string | undefined,
  targets: readonly ParkedTargetObservation[],
): Promise<boolean> {
  if (repositoryRoot === undefined) return true;
  for (const target of targets) {
    const commit = await resolveIntegrationTarget(repositoryRoot, target.ref).catch(() => null);
    if (
      commit === null ||
      (await integrationTargetBlobHash(repositoryRoot, commit, target.path)) !==
        target.observedHash ||
      (await integrationTargetBlobHash(repositoryRoot, "HEAD", target.path)) !== target.headHash ||
      (await workingTreeHash(repositoryRoot, target.path)) !== target.preimageHash
    )
      return false;
  }
  return true;
}

/**
 * The latest parked attention of an earlier obligation, still bound to the current bytes. A source
 * whose content changed is admitted again, so editing a parked document is the recovery. A source
 * parked by target divergence is also readmitted when its target bytes change.
 */
export async function carriedParkedSources(
  storage: {
    events: OutboxStore;
    artifacts: ArtifactStore;
    paths?: { repositoryRoot: string };
  },
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
  const carried = dependency.sources
    .map(parkedSource)
    .filter(
      (item): item is ParkedConvergenceSource =>
        item !== null &&
        (item.stage === "lifecycle" || sources.get(item.path)?.contentHash === item.contentHash),
    );
  const root = storage.paths?.repositoryRoot;
  const kept: ParkedConvergenceSource[] = [];
  const capacityHash =
    root !== undefined && carried.some((item) => item.layoutCapacityHash !== undefined)
      ? (await canonicalDocumentLayout(root)).capacityHash
      : undefined;
  for (const item of carried) {
    if (
      root !== undefined &&
      item.layoutCapacityHash !== undefined &&
      item.layoutCapacityHash !== capacityHash
    )
      continue;
    if (item.targets === undefined || (await targetsUnchanged(root, item.targets))) kept.push(item);
  }
  return kept;
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
