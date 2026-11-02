import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { sourceResponsibilityForPath } from "./canonicalization-responsibility.js";
import type { CanonicalizationResponsibility } from "./canonicalization-responsibility.js";
import {
  parseCanonicalizationOutcome,
  type CanonicalizationOutcome,
} from "./canonicalization-outcome.js";
import { isIgnorableFilesystemMetadata } from "./filesystem-metadata.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

export type CanonicalizationCandidateState =
  "candidate" | "pending" | "promoted" | "rejected" | "stale";

export type StoredCanonicalizationOutcome = CanonicalizationOutcome;

export interface CanonicalizationSourceBinding {
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
  responsibility: CanonicalizationResponsibility;
}

export interface CanonicalizationCandidateRecord {
  schemaVersion: 1;
  candidateId: string;
  state: Exclude<CanonicalizationCandidateState, "stale">;
  beforeRevision: string;
  afterRevision: string;
  sourceBindings: CanonicalizationSourceBinding[];
  recommendedRoots: string[];
  createdAt: string;
  outcome?: StoredCanonicalizationOutcome;
  review: null | { reviewerId: string; decision: "defer" | "reject"; reviewedAt: string };
  promotion: null | {
    reviewerId: string;
    targetPath: string;
    targetContentHash: string;
    promotedAt: string;
  };
}

export interface CanonicalizationCandidateInspection extends CanonicalizationCandidateRecord {
  observedState: CanonicalizationCandidateState;
  contentHash: string;
}

/**
 * ADR-0561: a candidate the background canonical reviewer deferred after its one regeneration is
 * held as Lervo debt. It is not reviewed again until its sources change or it is reopened.
 */
export function canonicalizationCandidateHeld(
  candidate: Pick<CanonicalizationCandidateRecord, "state" | "review">,
): boolean {
  return candidate.state === "pending" && candidate.review?.decision === "defer";
}

const ROOT = ".lervo/state/knowledge/canonicalization-candidates";
const MAXIMUM_CANDIDATE_RECORDS = 256;
export const MAXIMUM_CANONICALIZATION_SOURCE_BINDINGS = 256;

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  );
}

export function canonicalizationCandidatePath(candidateId: string): string {
  return `${ROOT}/${candidateId.slice("kcanon_".length, "kcanon_".length + 2)}/${candidateId}.json`;
}

async function boundedCandidatePaths(root: string): Promise<string[]> {
  const directory = resolve(root, ROOT);
  let shards;
  try {
    shards = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const paths: string[] = [];
  for (const shard of shards.sort((left, right) => left.name.localeCompare(right.name))) {
    if (isIgnorableFilesystemMetadata(shard)) continue;
    if (!shard.isDirectory() || !/^[a-f0-9]{2}$/u.test(shard.name))
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "The canonicalization candidate registry contains an unsafe entry.",
      );
    const entries = await readdir(resolve(directory, shard.name), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (isIgnorableFilesystemMetadata(entry)) continue;
      if (!entry.isFile() || !/^kcanon_[a-f0-9]{24}\.json$/u.test(entry.name))
        throw new RepositoryKnowledgeError(
          "knowledge_source_unsafe",
          "The canonicalization candidate shard contains an unsafe entry.",
        );
      paths.push(`${ROOT}/${shard.name}/${entry.name}`);
    }
  }
  if (paths.length > MAXIMUM_CANDIDATE_RECORDS)
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      `The canonicalization candidate registry exceeds ${MAXIMUM_CANDIDATE_RECORDS} records.`,
    );
  return paths;
}

function validateRecord(value: unknown): CanonicalizationCandidateRecord {
  const record = value as Partial<CanonicalizationCandidateRecord> | null;
  if (
    record === null ||
    typeof record !== "object" ||
    record.schemaVersion !== 1 ||
    typeof record.candidateId !== "string" ||
    !/^kcanon_[a-f0-9]{24}$/u.test(record.candidateId) ||
    !["candidate", "pending", "promoted", "rejected"].includes(record.state ?? "") ||
    typeof record.beforeRevision !== "string" ||
    typeof record.afterRevision !== "string" ||
    !Array.isArray(record.sourceBindings) ||
    record.sourceBindings.length === 0 ||
    record.sourceBindings.length > MAXIMUM_CANONICALIZATION_SOURCE_BINDINGS ||
    !record.sourceBindings.every(
      (item) =>
        safePath(item.path) &&
        (item.beforeHash === null || /^sha256:[a-f0-9]{64}$/u.test(item.beforeHash)) &&
        (item.afterHash === null || /^sha256:[a-f0-9]{64}$/u.test(item.afterHash)) &&
        sourceResponsibilityForPath(item.path) === item.responsibility,
    ) ||
    !Array.isArray(record.recommendedRoots) ||
    !record.recommendedRoots.every((path) => safePath(path)) ||
    typeof record.createdAt !== "string" ||
    (record.review !== null &&
      (typeof record.review !== "object" ||
        typeof record.review.reviewerId !== "string" ||
        !["defer", "reject"].includes(record.review.decision) ||
        typeof record.review.reviewedAt !== "string")) ||
    (record.promotion !== null &&
      (typeof record.promotion !== "object" ||
        typeof record.promotion.reviewerId !== "string" ||
        !safePath(record.promotion.targetPath) ||
        !/^sha256:[a-f0-9]{64}$/u.test(record.promotion.targetContentHash) ||
        typeof record.promotion.promotedAt !== "string"))
  )
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The canonicalization candidate record is invalid.",
    );
  if (record.outcome !== undefined) parseCanonicalizationOutcome(record.outcome);
  return record as CanonicalizationCandidateRecord;
}

export async function readCanonicalizationCandidate(
  root: string,
  path: string,
): Promise<CanonicalizationCandidateInspection> {
  const bytes = await readFile(resolve(root, path), "utf8");
  const record = validateRecord(JSON.parse(bytes));
  let stale = false;
  for (const binding of record.sourceBindings) {
    try {
      const stats = await lstat(resolve(root, binding.path));
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error();
      if (sha256(await readFile(resolve(root, binding.path))) !== binding.afterHash) stale = true;
    } catch {
      if (binding.afterHash !== null) stale = true;
    }
  }
  return {
    ...record,
    observedState:
      stale && !["promoted", "rejected"].includes(record.state) ? "stale" : record.state,
    contentHash: sha256(bytes),
  };
}

export async function listCanonicalizationCandidates(
  repositoryRoot: string,
): Promise<CanonicalizationCandidateInspection[]> {
  const root = resolve(repositoryRoot);
  return Promise.all(
    (await boundedCandidatePaths(root)).map((path) => readCanonicalizationCandidate(root, path)),
  );
}

export async function writeCanonicalizationCandidateRecord(
  root: string,
  record: CanonicalizationCandidateRecord,
): Promise<void> {
  const path = resolve(root, canonicalizationCandidatePath(record.candidateId));
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.next`;
  await rm(temporary, { force: true });
  await writeFile(temporary, `${canonicalJson(record)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}
