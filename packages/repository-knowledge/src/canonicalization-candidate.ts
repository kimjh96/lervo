import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  canonicalResponsibilityForPath,
  recommendedCanonicalRoot,
  sourceResponsibilityForPath,
  type CanonicalizationResponsibility,
} from "./canonicalization-responsibility.js";
import {
  parseCanonicalizationOutcome,
  validateCanonicalizationOutcomeForChange,
  type CanonicalizationOutcome,
} from "./canonicalization-outcome.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

export type { CanonicalizationResponsibility } from "./canonicalization-responsibility.js";

export type CanonicalizationCandidateState =
  "candidate" | "pending" | "promoted" | "rejected" | "stale";

interface SourceBinding {
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
  sourceBindings: SourceBinding[];
  recommendedRoots: string[];
  createdAt: string;
  outcome?: CanonicalizationOutcome;
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

export interface CanonicalizationAssessment {
  schemaVersion: 1;
  status: "current" | "candidate" | "pending";
  changedPathCount: number;
  canonicalPathCount: number;
  candidate: CanonicalizationCandidateInspection | null;
}

const ROOT = ".lervo/state/knowledge/canonicalization-candidates";
const MAXIMUM_ACTIVE_CANDIDATES = 64;
const MAXIMUM_CANDIDATE_RECORDS = 256;
const MAXIMUM_SOURCE_BINDINGS = 256;

function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  );
}

function candidatePath(candidateId: string): string {
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
    if (!shard.isDirectory() || !/^[a-f0-9]{2}$/u.test(shard.name))
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "The canonicalization candidate registry contains an unsafe entry.",
      );
    const entries = await readdir(resolve(directory, shard.name), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
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
    record.sourceBindings.length > MAXIMUM_SOURCE_BINDINGS ||
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

async function readCandidate(
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
  return Promise.all((await boundedCandidatePaths(root)).map((path) => readCandidate(root, path)));
}

async function writeRecord(root: string, record: CanonicalizationCandidateRecord): Promise<void> {
  const path = resolve(root, candidatePath(record.candidateId));
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.next`;
  await rm(temporary, { force: true });
  await writeFile(temporary, `${canonicalJson(record)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

export async function assessCanonicalization(input: {
  repositoryRoot: string;
  beforeRevision: string;
  afterRevision: string;
  beforeFiles: Readonly<Record<string, string>>;
  afterFiles: Readonly<Record<string, string>>;
  disposition: "canonical_sources_current" | "canonical_sources_updated" | "pending_user_approval";
  outcome?: CanonicalizationOutcome;
  now: Date;
}): Promise<CanonicalizationAssessment> {
  const paths = new Set([...Object.keys(input.beforeFiles), ...Object.keys(input.afterFiles)]);
  const changedPaths = [...paths]
    .filter((path) => input.beforeFiles[path] !== input.afterFiles[path])
    .sort();
  if (input.outcome !== undefined)
    validateCanonicalizationOutcomeForChange({
      outcome: input.outcome,
      disposition: input.disposition,
      beforeFiles: input.beforeFiles,
      afterFiles: input.afterFiles,
    });
  const canonicalResponsibilities = new Set(
    input.outcome === undefined
      ? changedPaths.flatMap((path) => {
          const responsibility = canonicalResponsibilityForPath(path);
          return responsibility === null ? [] : [responsibility];
        })
      : input.outcome.kind === "canonical_update"
        ? input.outcome.targets.flatMap((target) => {
            const responsibility = canonicalResponsibilityForPath(target.path);
            return responsibility === null ? [] : [responsibility];
          })
        : [],
  );
  const sourceBindings = changedPaths.flatMap((path) => {
    const responsibility = sourceResponsibilityForPath(path);
    if (responsibility === null || canonicalResponsibilityForPath(path) !== null) return [];
    if (canonicalResponsibilities.has(responsibility)) return [];
    return [
      {
        path,
        beforeHash: input.beforeFiles[path] ?? null,
        afterHash: input.afterFiles[path] ?? null,
        responsibility,
      },
    ];
  });
  if (sourceBindings.length > MAXIMUM_SOURCE_BINDINGS)
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      `Canonicalization candidate exceeds ${MAXIMUM_SOURCE_BINDINGS} source bindings.`,
    );
  if (sourceBindings.length === 0)
    return {
      schemaVersion: 1,
      status: "current",
      changedPathCount: changedPaths.length,
      canonicalPathCount: canonicalResponsibilities.size,
      candidate: null,
    };
  const candidateId = stableId("kcanon", {
    beforeRevision: input.beforeRevision,
    afterRevision: input.afterRevision,
    sourceBindings,
    outcome: input.outcome ?? null,
  });
  const record: CanonicalizationCandidateRecord = {
    schemaVersion: 1,
    candidateId,
    state: input.disposition === "pending_user_approval" ? "pending" : "candidate",
    beforeRevision: input.beforeRevision,
    afterRevision: input.afterRevision,
    sourceBindings,
    recommendedRoots: [
      ...new Set(sourceBindings.map((item) => recommendedCanonicalRoot(item.responsibility))),
    ].sort(),
    createdAt: input.now.toISOString(),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    review: null,
    promotion: null,
  };
  const candidates = await listCanonicalizationCandidates(input.repositoryRoot);
  const existing = candidates.find((item) => item.candidateId === candidateId);
  if (
    existing === undefined &&
    candidates.filter(
      (item) => item.observedState === "candidate" || item.observedState === "pending",
    ).length >= MAXIMUM_ACTIVE_CANDIDATES
  )
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      `The canonicalization candidate registry has ${MAXIMUM_ACTIVE_CANDIDATES} active records.`,
    );
  if (existing === undefined) await writeRecord(resolve(input.repositoryRoot), record);
  const candidate =
    existing ?? (await readCandidate(resolve(input.repositoryRoot), candidatePath(candidateId)));
  return {
    schemaVersion: 1,
    status: record.state === "pending" ? "pending" : "candidate",
    changedPathCount: changedPaths.length,
    canonicalPathCount: canonicalResponsibilities.size,
    candidate,
  };
}

export async function transitionCanonicalizationCandidate(input: {
  repositoryRoot: string;
  candidateId: string;
  expectedContentHash: string;
  action: "defer" | "reject" | "promote";
  reviewerId: string;
  targetPath?: string;
  targetContentHash?: string;
  now: Date;
}): Promise<CanonicalizationCandidateInspection> {
  const root = resolve(input.repositoryRoot);
  const current = (await listCanonicalizationCandidates(root)).find(
    (item) => item.candidateId === input.candidateId,
  );
  if (current === undefined || current.contentHash !== input.expectedContentHash)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The canonicalization candidate changed after review began.",
    );
  if (current.observedState === "stale" && input.action !== "reject")
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The canonicalization candidate source bindings are stale and permit rejection only.",
    );
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/u.test(input.reviewerId))
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "The canonicalization reviewer ID is invalid.",
    );
  const { observedState: _observedState, contentHash: _contentHash, ...currentRecord } = current;
  let next: CanonicalizationCandidateRecord;
  if (input.action === "promote") {
    if (
      input.targetPath === undefined ||
      input.targetContentHash === undefined ||
      canonicalResponsibilityForPath(input.targetPath) === null ||
      !current.sourceBindings.some(
        (binding) => binding.responsibility === canonicalResponsibilityForPath(input.targetPath!),
      )
    )
      throw new RepositoryKnowledgeError(
        "knowledge_approval_required",
        "Promotion requires one canonical target path and its exact current hash.",
      );
    const bytes = await readFile(resolve(root, input.targetPath));
    if (sha256(bytes) !== input.targetContentHash)
      throw new RepositoryKnowledgeError(
        "knowledge_plan_stale",
        "The canonical promotion target does not match the reviewed hash.",
      );
    next = {
      ...currentRecord,
      state: "promoted",
      review: null,
      promotion: {
        reviewerId: input.reviewerId,
        targetPath: input.targetPath,
        targetContentHash: input.targetContentHash,
        promotedAt: input.now.toISOString(),
      },
    };
  } else {
    next = {
      ...currentRecord,
      state: input.action === "defer" ? "pending" : "rejected",
      review: {
        reviewerId: input.reviewerId,
        decision: input.action,
        reviewedAt: input.now.toISOString(),
      },
      promotion: null,
    };
  }
  await writeRecord(root, next);
  return readCandidate(root, candidatePath(input.candidateId));
}
