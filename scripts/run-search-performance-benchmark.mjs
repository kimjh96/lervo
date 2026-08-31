import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { bm25fSearchEvaluationEngine } from "../packages/search-adapter-bm25f/dist/index.js";
import { lexicalV2SearchEvaluationEngine } from "../packages/search-adapter-lexical-v2/dist/index.js";
import {
  canonicalHash,
  contentId,
  currentSearchPerformanceEnvironment,
  runSearchPerformanceBenchmark,
  SEARCH_ENGINE,
  LexicalSearchIndex,
} from "../packages/search/dist/index.js";

import { loadDelegatedRetrievalCorpus } from "./natural-language-evaluation/delegated-retrieval-workspace.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const baselineEngine = {
  engine: SEARCH_ENGINE,
  adapterBuildId: contentId("sebuild", {
    package: "@lervo/search",
    engine: SEARCH_ENGINE,
    scoring: "lexical-v1",
  }),
  buildIndex: (sources) => new LexicalSearchIndex(sources),
};

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const parsed = parseArgs({
    args,
    strict: true,
    options: {
      suite: { type: "string" },
      candidate: { type: "string", default: "lexical-v2" },
      summary: { type: "boolean" },
    },
  });
  if (parsed.values.suite === undefined) {
    throw new TypeError("Use --suite <repository-relative-suite-path>.");
  }
  const candidates = new Map([
    ["bm25f-v1", bm25fSearchEvaluationEngine],
    ["lexical-v2", lexicalV2SearchEvaluationEngine],
  ]);
  const candidateEngine = candidates.get(parsed.values.candidate);
  if (candidateEngine === undefined) {
    throw new TypeError("Candidate must be bm25f-v1 or lexical-v2.");
  }
  const suiteInput = JSON.parse(
    await readFile(resolve(repositoryRoot, parsed.values.suite), "utf8"),
  );
  const suite =
    suiteInput.baseSuite === undefined
      ? suiteInput
      : await (async () => {
          const base = JSON.parse(
            await readFile(resolve(repositoryRoot, suiteInput.baseSuite), "utf8"),
          );
          if (
            JSON.stringify(base.corpusRoots) !== JSON.stringify(suiteInput.corpusRoots) ||
            JSON.stringify(base.corpusExclusions) !== JSON.stringify(suiteInput.corpusExclusions)
          ) {
            throw new TypeError("An augmented suite must preserve its base corpus contract.");
          }
          return {
            ...suiteInput,
            publicQueries: base.publicQueries === true && suiteInput.publicQueries === true,
            cases: [...base.cases, ...suiteInput.cases],
          };
        })();
  const corpus = await loadDelegatedRetrievalCorpus(repositoryRoot, suite);
  const sourceByPath = new Map(corpus.map((source) => [source.path, source]));
  const cases = suite.cases.map((item) => ({
    caseId: item.caseId,
    taskType: item.taskType,
    provenance: item.provenance,
    query: item.query,
    expectedSources: item.expectedPaths.map((path) => {
      const source = sourceByPath.get(path);
      if (source === undefined) throw new TypeError(`${item.caseId} expected source is absent.`);
      return { kind: source.kind, sourceId: source.sourceId };
    }),
    maximumRank: item.maximumRank,
  }));
  const report = await runSearchPerformanceBenchmark({
    suiteId: suite.suiteId,
    suiteHash: canonicalHash(suite),
    suiteQueries: suite.publicQueries
      ? "declared_public_verification_inputs"
      : "owner_readable_case_records",
    corpus,
    corpusByteCount: corpus.reduce(
      (sum, source) => sum + Buffer.byteLength(source.text, "utf8"),
      0,
    ),
    cases,
    baselineEngine,
    candidateEngine,
    evaluatedAt: new Date(),
    environment: currentSearchPerformanceEnvironment(),
  });
  const output = parsed.values.summary
    ? {
        reportId: report.reportId,
        suiteId: report.suiteId,
        corpusDigest: report.corpusDigest,
        corpusDocumentCount: report.corpusDocumentCount,
        protocol: report.protocol,
        baseline: {
          engine: report.baseline.engine,
          adapterBuildId: report.baseline.adapterBuildId,
          quality: report.baseline.quality,
          buildLatency: report.baseline.buildLatency,
          warmQueryLatency: report.baseline.warmQueryLatency,
        },
        candidate: {
          engine: report.candidate.engine,
          adapterBuildId: report.candidate.adapterBuildId,
          quality: report.candidate.quality,
          buildLatency: report.candidate.buildLatency,
          warmQueryLatency: report.candidate.warmQueryLatency,
        },
        comparison: report.comparison,
      }
    : report;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

await main();
