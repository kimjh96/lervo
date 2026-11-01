import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { projectTaskQuery } from "@lervo/context";
import { loadDecisionTaxonomy, type DecisionTaxonomy } from "@lervo/project";
import { productDefaultRepositoryKnowledgeRanker } from "@lervo/repository-context";
import {
  LERVO_KNOWLEDGE_COMMIT_EMAIL,
  RepositoryKnowledgeQueryIndex,
  repositoryScanPriority,
  repositorySourceKindForPath,
} from "@lervo/repository-knowledge";

import { readPrivateStateJson, writePrivateStateJson } from "./private-state-file.js";
import { governingPreference } from "./governing-preference.js";

const execute = promisify(execFile);
const SCANNED_COMMITS = 600;
const MAXIMUM_TARGET_PATHS = 64;

/** One past development change: the code it touched and the governing documents it co-changed. */
export interface FindReplayCase {
  commit: string;
  subject: string;
  targetPaths: string[];
  expected: string[];
}

export interface FindReplayCaseResult {
  commit: string;
  expectedCount: number;
  foundCount: number;
  /** 1-based rank of the first expected document, or null when none was returned. */
  firstRank: number | null;
  recall: number;
  precision: number;
}

export interface FindReplayReport {
  schemaVersion: 1;
  kind: "find_replay.report";
  observedAt: string;
  limit: number;
  caseCount: number;
  /** Mean over cases of found expected documents divided by expected documents. */
  recall: number | null;
  /** Mean over cases of found expected documents divided by returned hits. */
  precision: number | null;
  /** Share of cases with at least one expected document returned. */
  hitRate: number | null;
  meanReciprocalRank: number | null;
  cases: FindReplayCaseResult[];
}

const GOVERNING = new Set(["instructions", "portable_skills", "canonical_documents"]);
const TARGET_KINDS = new Set(["code", "configuration", "test", "schema", "build_definition"]);

/** Splits one commit's changed paths into the code it targets and the governing documents. */
export function classifyReplayPaths(
  paths: readonly string[],
  taxonomy: DecisionTaxonomy,
): { targetPaths: string[]; expected: string[] } {
  const targetPaths: string[] = [];
  const expected: string[] = [];
  for (const path of paths) {
    // Lervo configuration and release-intent records are not the development work being replayed.
    if (path.startsWith(".lervo/") || path.startsWith(".changes/")) continue;
    const priority = repositoryScanPriority(path, taxonomy);
    // Only real development sources are targets; images, logs, and unclassified files are not.
    if (priority === "source_and_configuration") {
      if (TARGET_KINDS.has(repositorySourceKindForPath(path))) targetPaths.push(path);
    } else if (GOVERNING.has(priority) && /\.mdx?$/iu.test(path)) expected.push(path);
  }
  return { targetPaths: targetPaths.slice(0, MAXIMUM_TARGET_PATHS), expected };
}

/** Pure scoring of one case against ranked hit paths. */
export function scoreReplayCase(
  replay: FindReplayCase,
  hitPaths: readonly string[],
): FindReplayCaseResult {
  const expected = new Set(replay.expected);
  const found = hitPaths.filter((path) => expected.has(path));
  const firstIndex = hitPaths.findIndex((path) => expected.has(path));
  return {
    commit: replay.commit,
    expectedCount: expected.size,
    foundCount: found.length,
    firstRank: firstIndex === -1 ? null : firstIndex + 1,
    recall: found.length / expected.size,
    precision: hitPaths.length === 0 ? 0 : found.length / hitPaths.length,
  };
}

export function summarizeReplay(
  results: readonly FindReplayCaseResult[],
  limit: number,
  now: Date,
): FindReplayReport {
  const mean = (values: number[]) =>
    values.length === 0
      ? null
      : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
  return {
    schemaVersion: 1,
    kind: "find_replay.report",
    observedAt: now.toISOString(),
    limit,
    caseCount: results.length,
    recall: mean(results.map((result) => result.recall)),
    precision: mean(results.map((result) => result.precision)),
    hitRate: mean(results.map((result) => (result.foundCount > 0 ? 1 : 0))),
    meanReciprocalRank: mean(
      results.map((result) => (result.firstRank === null ? 0 : 1 / result.firstRank)),
    ),
    cases: [...results],
  };
}

/**
 * ADR-0550: past non-merge development commits that changed code and governing documents together.
 * Lervo's own commits are excluded. Expected documents must still exist, so the current index can
 * be asked for them.
 */
export async function collectReplayCases(
  root: string,
  maximumCases: number,
): Promise<FindReplayCase[]> {
  const taxonomy = await loadDecisionTaxonomy(root);
  const { stdout } = await execute(
    "git",
    [
      "-C",
      root,
      "-c",
      "core.quotePath=false",
      "log",
      "--no-merges",
      `--max-count=${SCANNED_COMMITS}`,
      "--format=%x1e%H%x1f%ae%x1f%s",
      "--name-only",
      "--no-renames",
      "HEAD",
    ],
    { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
  );
  const cases: FindReplayCase[] = [];
  for (const block of stdout.split("\x1e")) {
    if (cases.length >= maximumCases) break;
    const [header = "", ...lines] = block.split("\n");
    const [commit = "", email = "", subject = ""] = header.split("\x1f");
    if (commit === "" || email === LERVO_KNOWLEDGE_COMMIT_EMAIL) continue;
    const paths = lines.filter((line) => line.length > 0);
    const { targetPaths, expected } = classifyReplayPaths(paths, taxonomy);
    const present = expected.filter((path) => existsSync(resolve(root, path)));
    if (targetPaths.length === 0 || present.length === 0) continue;
    cases.push({ commit, subject, targetPaths, expected: present });
  }
  return cases;
}

/** Replays each case through the same projected query and product ranker an agent query uses. */
export async function runFindReplay(input: {
  root: string;
  maximumCases: number;
  limit: number;
  now?: Date;
}): Promise<FindReplayReport> {
  const cases = await collectReplayCases(input.root, input.maximumCases);
  const index = await RepositoryKnowledgeQueryIndex.prepare({
    repositoryRoot: input.root,
    ranker: productDefaultRepositoryKnowledgeRanker,
  });
  const results: FindReplayCaseResult[] = [];
  for (const replay of cases) {
    const projection = projectTaskQuery({
      intent: replay.subject,
      continuation: "",
      targetPaths: replay.targetPaths,
    });
    const result = await index.query({
      query: projection.query,
      limit: input.limit,
      preferred: await governingPreference(input.root, replay.targetPaths),
    });
    results.push(
      scoreReplayCase(
        replay,
        result.hits.map((hit) => hit.path),
      ),
    );
  }
  return summarizeReplay(results, input.limit, input.now ?? new Date());
}

const STATE = "find-replay.json";

export async function writeFindReplayReport(root: string, report: FindReplayReport): Promise<void> {
  await writePrivateStateJson(root, STATE, report);
}

/** The last replay summary for health, or null when missing or invalid. */
export async function readFindReplaySummary(
  root: string,
): Promise<Pick<FindReplayReport, "observedAt" | "caseCount" | "recall" | "precision"> | null> {
  const value = (await readPrivateStateJson(root, STATE, 256 * 1024)) as FindReplayReport | null;
  const rate = (rate: unknown) =>
    rate === null || (typeof rate === "number" && rate >= 0 && rate <= 1);
  if (
    value?.schemaVersion !== 1 ||
    value.kind !== "find_replay.report" ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    !Number.isSafeInteger(value.caseCount) ||
    !rate(value.recall) ||
    !rate(value.precision)
  )
    return null;
  return {
    observedAt: value.observedAt,
    caseCount: value.caseCount,
    recall: value.recall,
    precision: value.precision,
  };
}
