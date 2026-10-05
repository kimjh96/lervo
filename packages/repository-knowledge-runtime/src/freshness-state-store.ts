import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  documentFreshnessCandidateIdPattern,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessHold,
  type DocumentFreshnessSummary,
} from "@lervo/repository-knowledge";

/**
 * Rebuildable freshness state under `.lervo/state/knowledge/` (ADR-0463): candidates sharded by
 * identifier, holds by finding, and one cycle file. Events plus the repository can rebuild every
 * record; nothing here is canonical and nothing is tracked.
 */
export const FRESHNESS_CANDIDATE_ROOT = ".lervo/state/knowledge/freshness-candidates";
export const FRESHNESS_HOLD_ROOT = ".lervo/state/knowledge/freshness-holds";
export const FRESHNESS_CYCLE_PATH = ".lervo/state/knowledge/freshness-cycle.json";

const MAXIMUM_RECORD_BYTES = 512 * 1024;
const MAXIMUM_CANDIDATES = 512;
const MAXIMUM_HOLDS = 512;
const TERMINAL_RETENTION_MILLISECONDS = 30 * 86_400_000;
const TERMINAL_STATES = new Set<DocumentFreshnessCandidateV1["state"]>([
  "applied",
  "rejected",
  "superseded",
  "reverted",
  "verified",
]);

export interface FreshnessCycleState {
  schemaVersion: 1;
  /** Fence over HEAD, working-tree status, policy, holds, and candidate states. */
  observationKey: string | null;
  findingsDigest: string | null;
  /** First observation time per finding digest, so priority ages survive restarts. */
  firstSeen: Record<string, string>;
  budget: { day: string; tokensUsed: number; attempts: number; verified: number };
  summary: DocumentFreshnessSummary;
  lastCycleAt: string | null;
}

export function emptyFreshnessCycleState(): FreshnessCycleState {
  return {
    schemaVersion: 1,
    observationKey: null,
    findingsDigest: null,
    firstSeen: {},
    budget: { day: "", tokensUsed: 0, attempts: 0, verified: 0 },
    summary: {
      staleCount: 0,
      safetyCount: 0,
      firstSafetyPath: null,
      awaitingReviewCount: 0,
      appliedRecentPaths: [],
      blocked: false,
    },
    lastCycleAt: null,
  };
}

async function ensureDirectory(root: string, relative: string): Promise<string> {
  let directory = resolve(root);
  for (const part of relative.split("/")) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Document freshness state directory is invalid.");
  }
  return directory;
}

async function writeAtomically(root: string, relative: string, value: unknown): Promise<void> {
  const parts = relative.split("/");
  const directory = await ensureDirectory(root, parts.slice(0, -1).join("/"));
  const temporary = resolve(directory, `.freshness-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(root, relative));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readRecord<T>(path: string): Promise<T | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAXIMUM_RECORD_BYTES) return null;
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function candidatePath(candidateId: string): string {
  const hex = candidateId.slice("kfresh_".length);
  return `${FRESHNESS_CANDIDATE_ROOT}/${hex.slice(0, 2)}/${candidateId}.json`;
}

function validCandidate(value: unknown): value is DocumentFreshnessCandidateV1 {
  const item = value as Partial<DocumentFreshnessCandidateV1> | null;
  return (
    item !== null &&
    typeof item === "object" &&
    item.schemaVersion === 1 &&
    typeof item.candidateId === "string" &&
    documentFreshnessCandidateIdPattern.test(item.candidateId) &&
    typeof item.documentPath === "string" &&
    typeof item.state === "string" &&
    Array.isArray(item.hunks)
  );
}

export async function readFreshnessCandidate(
  root: string,
  candidateId: string,
): Promise<DocumentFreshnessCandidateV1 | null> {
  if (!documentFreshnessCandidateIdPattern.test(candidateId)) return null;
  const value = await readRecord<unknown>(resolve(root, candidatePath(candidateId)));
  return validCandidate(value) && value.candidateId === candidateId ? value : null;
}

export async function writeFreshnessCandidate(
  root: string,
  candidate: DocumentFreshnessCandidateV1,
): Promise<void> {
  await writeAtomically(root, candidatePath(candidate.candidateId), candidate);
}

/** Every readable candidate, newest update first; unreadable records are skipped, not repaired. */
export async function listFreshnessCandidates(
  root: string,
): Promise<DocumentFreshnessCandidateV1[]> {
  const base = resolve(root, FRESHNESS_CANDIDATE_ROOT);
  let shards: string[];
  try {
    shards = (await readdir(base)).filter((name) => /^[a-f0-9]{2}$/u.test(name)).sort();
  } catch {
    return [];
  }
  const candidates: DocumentFreshnessCandidateV1[] = [];
  for (const shard of shards) {
    let names: string[];
    try {
      names = (await readdir(resolve(base, shard))).filter((name) => name.endsWith(".json")).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const value = await readRecord<unknown>(resolve(base, shard, name));
      if (validCandidate(value) && `${value.candidateId}.json` === name) candidates.push(value);
    }
  }
  return candidates.sort((left, right) =>
    left.updatedAt === right.updatedAt
      ? left.candidateId.localeCompare(right.candidateId)
      : right.updatedAt.localeCompare(left.updatedAt),
  );
}

function holdPath(findingDigest: string): string {
  return `${FRESHNESS_HOLD_ROOT}/${findingDigest.slice("sha256:".length, "sha256:".length + 32)}.json`;
}

export async function writeFreshnessHold(root: string, hold: DocumentFreshnessHold): Promise<void> {
  await writeAtomically(root, holdPath(hold.findingDigest), hold);
}

export async function listFreshnessHolds(root: string): Promise<DocumentFreshnessHold[]> {
  const base = resolve(root, FRESHNESS_HOLD_ROOT);
  let names: string[];
  try {
    names = (await readdir(base)).filter((name) => /^[a-f0-9]{32}\.json$/u.test(name)).sort();
  } catch {
    return [];
  }
  const holds: DocumentFreshnessHold[] = [];
  for (const name of names) {
    const value = await readRecord<DocumentFreshnessHold>(resolve(base, name));
    if (
      value?.schemaVersion === 1 &&
      typeof value.findingDigest === "string" &&
      typeof value.documentPath === "string" &&
      Number.isFinite(Date.parse(value.until))
    )
      holds.push(value);
  }
  return holds;
}

export async function readFreshnessCycleState(root: string): Promise<FreshnessCycleState> {
  const value = await readRecord<Partial<FreshnessCycleState>>(resolve(root, FRESHNESS_CYCLE_PATH));
  const empty = emptyFreshnessCycleState();
  if (value?.schemaVersion !== 1 || typeof value.budget !== "object" || value.budget === null)
    return empty;
  return {
    ...empty,
    ...value,
    firstSeen: { ...(value.firstSeen ?? {}) },
    summary: { ...empty.summary, ...(value.summary ?? {}) },
  } as FreshnessCycleState;
}

export async function writeFreshnessCycleState(
  root: string,
  state: FreshnessCycleState,
): Promise<void> {
  await writeAtomically(root, FRESHNESS_CYCLE_PATH, state);
}

/**
 * Bounded retention: terminal candidates older than 30 days and expired holds are removed, and
 * the store keeps at most 512 candidates and 512 holds, newest first. Open candidates are kept.
 */
export async function pruneFreshnessState(root: string, now: Date): Promise<void> {
  const candidates = await listFreshnessCandidates(root);
  let kept = 0;
  for (const candidate of candidates) {
    const terminal = TERMINAL_STATES.has(candidate.state);
    const expired =
      now.getTime() - Date.parse(candidate.updatedAt) > TERMINAL_RETENTION_MILLISECONDS;
    if (terminal && (expired || kept >= MAXIMUM_CANDIDATES))
      await rm(resolve(root, candidatePath(candidate.candidateId)), { force: true });
    else kept += 1;
  }
  const holds = (await listFreshnessHolds(root)).sort((left, right) =>
    right.until.localeCompare(left.until),
  );
  for (const [index, hold] of holds.entries())
    if (Date.parse(hold.until) <= now.getTime() || index >= MAXIMUM_HOLDS)
      await rm(resolve(root, holdPath(hold.findingDigest)), { force: true });
}

/** The fence input ADR-0461 adds: the last recorded findings digest, or null. */
export async function readFreshnessFindingsDigest(root: string): Promise<string | null> {
  return (await readFreshnessCycleState(root)).findingsDigest;
}
