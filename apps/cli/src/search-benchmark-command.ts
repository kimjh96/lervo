import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { readRepositoryFile } from "@lervo/context";
import {
  canonicalHash,
  contentId,
  currentSearchPerformanceEnvironment,
  LexicalSearchIndex,
  nanosecondsToMilliseconds,
  runSearchPerformanceBenchmark,
  SEARCH_ENGINE,
  type SearchEvaluationEnginePort,
  type SearchPerformanceCase,
  type SearchPerformanceReport,
  type SearchSourceInput,
} from "@lervo/search";
import { localHybridSearchEvaluationEngine } from "@lervo/search-adapter-local-hybrid";

import { searchArgumentError, searchUsage } from "./search-command-common.js";
import type { CliIo } from "./types.js";

const MAXIMUM_SUITE_BYTES = 128 * 1024;
const MAXIMUM_CORPUS_FILES = 512;
const MAXIMUM_DOCUMENT_BYTES = 128 * 1024;
const MAXIMUM_CORPUS_BYTES = 16 * 1024 * 1024;

interface RepositoryBenchmarkSuite {
  schemaVersion: 1;
  suiteId: string;
  publicQueries: boolean;
  corpusRoots: string[];
  corpusExclusions: string[];
  taskTypes: Array<{ taskType: string; minimumCases: 5 }>;
  cases: Array<{
    caseId: string;
    taskType: string;
    provenance: "human_reviewed" | "verification_authored";
    query: string;
    expectedPaths: string[];
    maximumRank: 10;
  }>;
}

function repositoryPath(root: string, path: string): string {
  const target = resolve(root, path);
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${sep}`) || resolve(root, child) !== target) {
    throw new Error("The benchmark path escapes the repository.");
  }
  return child.replaceAll(sep, posix.sep);
}

async function markdownPaths(
  root: string,
  roots: readonly string[],
  exclusions: readonly string[],
): Promise<string[]> {
  const paths: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const child = repositoryPath(root, path);
    const target = resolve(root, child);
    const status = await lstat(target);
    if (status.isSymbolicLink()) throw new Error("Benchmark corpus roots cannot contain symlinks.");
    if (status.isFile()) {
      if (child.endsWith(".md")) paths.push(child);
      return;
    }
    if (!status.isDirectory())
      throw new Error("A benchmark corpus root is not a file or directory.");
    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink())
        throw new Error("Benchmark corpus directories cannot contain symlinks.");
      await visit(posix.join(child, entry.name));
      if (paths.length > MAXIMUM_CORPUS_FILES)
        throw new Error("The benchmark corpus is too large.");
    }
  };
  for (const path of roots) await visit(path);
  const excluded = exclusions.map((path) => repositoryPath(root, path));
  const unique = [...new Set(paths)]
    .filter(
      (path) =>
        !excluded.some((exclusion) => path === exclusion || path.startsWith(`${exclusion}/`)),
    )
    .sort();
  if (unique.length < 1 || unique.length > MAXIMUM_CORPUS_FILES) {
    throw new Error("The benchmark Markdown corpus size is invalid.");
  }
  return unique;
}

function benchmarkSourceId(path: string): string {
  return contentId("doc_bench", { path });
}

function heading(text: string): string | undefined {
  return /^#{1,6}\s+(.{1,500})\s*$/mu.exec(text)?.[1]?.trim();
}

async function corpus(
  root: string,
  paths: readonly string[],
): Promise<{
  sources: SearchSourceInput[];
  byteCount: number;
}> {
  let byteCount = 0;
  const sources: SearchSourceInput[] = [];
  for (const path of paths) {
    const bytes = await readRepositoryFile(root, path, MAXIMUM_DOCUMENT_BYTES);
    byteCount += bytes.byteLength;
    if (byteCount > MAXIMUM_CORPUS_BYTES) throw new Error("The benchmark corpus exceeds 16 MiB.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.length === 0) throw new Error("A benchmark document is empty.");
    const title = heading(text);
    sources.push({
      kind: "document",
      sourceId: benchmarkSourceId(path),
      path,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      ...(title === undefined ? {} : { title }),
      labels: path.split("/").slice(0, -1),
      text,
    });
  }
  return { sources, byteCount };
}

function suiteCases(
  suite: RepositoryBenchmarkSuite,
  paths: ReadonlySet<string>,
): SearchPerformanceCase[] {
  if (
    suite.schemaVersion !== 1 ||
    !/^spbench_[a-z0-9][a-z0-9_.-]{2,95}$/u.test(suite.suiteId) ||
    suite.publicQueries !== true ||
    !Array.isArray(suite.corpusRoots) ||
    suite.corpusRoots.length < 1 ||
    suite.corpusRoots.length > 8 ||
    !Array.isArray(suite.corpusExclusions) ||
    suite.corpusExclusions.length > 8 ||
    !Array.isArray(suite.taskTypes) ||
    suite.taskTypes.length !== 4 ||
    !Array.isArray(suite.cases) ||
    suite.cases.length !== 20
  ) {
    throw new Error("The repository benchmark suite contract is invalid.");
  }
  const taskTypes = new Map(suite.taskTypes.map((item) => [item.taskType, item.minimumCases]));
  if (taskTypes.size !== 4 || [...taskTypes.values()].some((minimum) => minimum !== 5)) {
    throw new Error("The benchmark requires four distinct five-case task types.");
  }
  const cases = suite.cases.map((item) => {
    if (
      !taskTypes.has(item.taskType) ||
      !Array.isArray(item.expectedPaths) ||
      item.expectedPaths.length < 1 ||
      item.expectedPaths.length > 8 ||
      item.expectedPaths.some((path) => !paths.has(path))
    ) {
      throw new Error("A benchmark case references an invalid task type or document.");
    }
    return {
      caseId: item.caseId,
      taskType: item.taskType,
      provenance: item.provenance,
      query: item.query,
      expectedSources: item.expectedPaths.map((path) => ({
        kind: "document" as const,
        sourceId: benchmarkSourceId(path),
      })),
      maximumRank: item.maximumRank,
    };
  });
  for (const taskType of taskTypes.keys()) {
    if (cases.filter((item) => item.taskType === taskType).length !== 5) {
      throw new Error("Every benchmark task type must contain exactly five cases.");
    }
  }
  return cases;
}

const lexicalBenchmarkEngine: SearchEvaluationEnginePort = {
  engine: SEARCH_ENGINE,
  adapterBuildId: contentId("sebuild", {
    package: "@lervo/search",
    implementation: "lexical-v1",
    benchmarkBoundary: 1,
  }),
  buildIndex: (sources) => new LexicalSearchIndex(sources),
};

async function recordReport(root: string, report: SearchPerformanceReport): Promise<string> {
  const path = resolve(root, ".lervo/state/search/performance-reports", `${report.reportId}.json`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error("The performance report already exists.", { cause: error });
  }
  return repositoryPath(root, path);
}

function percent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

function format(report: SearchPerformanceReport, reportPath: string): string {
  return (
    [
      `Search performance observation: ${report.reportId}`,
      `  Corpus ${report.corpusDocumentCount} documents · ${report.corpusByteCount} bytes`,
      `  Quality Success@10: lexical ${percent(report.baseline.quality.successAt10BasisPoints)} · hybrid ${percent(report.candidate.quality.successAt10BasisPoints)} · delta ${percent(report.comparison.successAt10DeltaBasisPoints)}`,
      `  Quality Recall@10: lexical ${percent(report.baseline.quality.meanRecallAt10BasisPoints)} · hybrid ${percent(report.candidate.quality.meanRecallAt10BasisPoints)} · delta ${percent(report.comparison.recallAt10DeltaBasisPoints)}`,
      `  Quality MRR: lexical ${percent(report.baseline.quality.meanReciprocalRankBasisPoints)} · hybrid ${percent(report.candidate.quality.meanReciprocalRankBasisPoints)} · delta ${percent(report.comparison.reciprocalRankDeltaBasisPoints)}`,
      `  Build p50/p95: lexical ${nanosecondsToMilliseconds(report.baseline.buildLatency.p50Nanoseconds).toFixed(3)}/${nanosecondsToMilliseconds(report.baseline.buildLatency.p95Nanoseconds).toFixed(3)} ms · hybrid ${nanosecondsToMilliseconds(report.candidate.buildLatency.p50Nanoseconds).toFixed(3)}/${nanosecondsToMilliseconds(report.candidate.buildLatency.p95Nanoseconds).toFixed(3)} ms`,
      `  Warm query p50/p95: lexical ${nanosecondsToMilliseconds(report.baseline.warmQueryLatency.p50Nanoseconds).toFixed(3)}/${nanosecondsToMilliseconds(report.baseline.warmQueryLatency.p95Nanoseconds).toFixed(3)} ms · hybrid ${nanosecondsToMilliseconds(report.candidate.warmQueryLatency.p50Nanoseconds).toFixed(3)}/${nanosecondsToMilliseconds(report.candidate.warmQueryLatency.p95Nanoseconds).toFixed(3)} ms`,
      `  Observation: quality ${report.comparison.qualityObservation} · ranking ${report.comparison.rankingObservation} · cost ${report.comparison.observedCostAcceptable ? "acceptable" : "over threshold"} · adoption not determined`,
      `  Report ${reportPath}`,
    ].join("\n") + "\n"
  );
}

export async function runSearchBenchmarkCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: { root: { type: "string" }, suite: { type: "string" }, json: { type: "boolean" } },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  if (parsed.values.suite === undefined) {
    io.stderr(`A repository benchmark --suite is required.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const suitePath = repositoryPath(root, parsed.values.suite);
    const suiteBytes = await readRepositoryFile(root, suitePath, MAXIMUM_SUITE_BYTES);
    const suite = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(suiteBytes),
    ) as RepositoryBenchmarkSuite;
    const paths = await markdownPaths(root, suite.corpusRoots, suite.corpusExclusions);
    const loaded = await corpus(root, paths);
    const report = await runSearchPerformanceBenchmark({
      suiteId: suite.suiteId,
      suiteHash: canonicalHash(suite),
      suiteQueries: "declared_public_verification_inputs",
      corpus: loaded.sources,
      corpusByteCount: loaded.byteCount,
      cases: suiteCases(suite, new Set(paths)),
      baselineEngine: lexicalBenchmarkEngine,
      candidateEngine: localHybridSearchEvaluationEngine,
      evaluatedAt: new Date(),
      environment: currentSearchPerformanceEnvironment(),
    });
    const reportPath = await recordReport(root, report);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ report, reportPath }, null, 2)}\n`
        : format(report, reportPath),
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Could not complete the search performance benchmark. ${error instanceof Error ? error.message : "Unknown error."}\n`,
    );
    return 1;
  }
}
