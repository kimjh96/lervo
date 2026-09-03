import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import { ClaudeAdapter } from "../../packages/adapter-claude/dist/index.js";
import { CodexAdapter } from "../../packages/adapter-codex/dist/index.js";
import { loadProjectManifest } from "../../packages/project/dist/index.js";
import { LexicalSearchIndex } from "../../packages/search/dist/index.js";

import {
  delegatedRetrievalDigest,
  validateDelegatedRetrievalSuite,
} from "../natural-language-evaluation/delegated-retrieval-contract.mjs";
import { runDelegatedRetrievalBenchmark } from "../natural-language-evaluation/delegated-retrieval-runner.mjs";
import {
  runBoundedFallbackBenchmark,
  validateFallbackRecommendations,
} from "../natural-language-evaluation/bounded-retrieval-runner.mjs";
import {
  validateLexicalAssistedV2Recommendations,
  validateLexicalAssistedV2Suite,
} from "../natural-language-evaluation/lexical-assisted-v2-contract.mjs";
import { runLexicalAssistedV2Benchmark } from "../natural-language-evaluation/lexical-assisted-v2-runner.mjs";
import {
  validateCatalogAssistedV3Recommendations,
  validateCatalogAssistedV3Suite,
} from "../natural-language-evaluation/catalog-assisted-v3-contract.mjs";
import { runCatalogAssistedV3Benchmark } from "../natural-language-evaluation/catalog-assisted-v3-runner.mjs";
import {
  buildCoreTermAssistedV4Coverage,
  validateCoreTermAssistedV4Recommendations,
  validateCoreTermAssistedV4Suite,
} from "../natural-language-evaluation/core-term-assisted-v4-contract.mjs";
import { runCoreTermAssistedV4Benchmark } from "../natural-language-evaluation/core-term-assisted-v4-runner.mjs";
import {
  buildReferenceMarkerAssistedV5Coverage,
  validateReferenceMarkerAssistedV5Recommendations,
  validateReferenceMarkerAssistedV5Suite,
} from "../natural-language-evaluation/reference-marker-assisted-v5-contract.mjs";
import { runReferenceMarkerAssistedV5Benchmark } from "../natural-language-evaluation/reference-marker-assisted-v5-runner.mjs";
import {
  buildMarkerDerivedPathsV6Coverage,
  validateMarkerDerivedPathsV6Recommendations,
  validateMarkerDerivedPathsV6Suite,
} from "../natural-language-evaluation/marker-derived-paths-v6-contract.mjs";
import { runMarkerDerivedPathsV6Benchmark } from "../natural-language-evaluation/marker-derived-paths-v6-runner.mjs";
import {
  buildStagedEvidenceV7Coverage,
  buildStagedEvidenceV7NoHitCatalog,
  validateStagedEvidenceV7Recommendations,
  validateStagedEvidenceV7Suite,
} from "../natural-language-evaluation/staged-evidence-v7-contract.mjs";
import { runStagedEvidenceV7Benchmark } from "../natural-language-evaluation/staged-evidence-v7-runner.mjs";
import {
  buildLinkedEvidenceReconciliationV8Coverage,
  buildLinkedEvidenceReconciliationV8Expansion,
  buildLinkedEvidenceReconciliationV8NoHitCatalog,
  validateLinkedEvidenceReconciliationV8Recommendations,
  validateLinkedEvidenceReconciliationV8Suite,
} from "../natural-language-evaluation/linked-evidence-reconciliation-v8-contract.mjs";
import { runLinkedEvidenceReconciliationV8Benchmark } from "../natural-language-evaluation/linked-evidence-reconciliation-v8-runner.mjs";
import {
  linkedEvidenceReconciliationConfirmationV9SuiteId,
  validateLinkedEvidenceReconciliationConfirmationV9Suite,
} from "../natural-language-evaluation/linked-evidence-reconciliation-confirmation-v9-contract.mjs";
import { runLinkedEvidenceReconciliationConfirmationV9Benchmark } from "../natural-language-evaluation/linked-evidence-reconciliation-confirmation-v9-runner.mjs";
import {
  copySanitizedEvaluationWorkspace,
  isWithinPath,
  loadDelegatedRetrievalCorpus,
  observeRepositorySnapshot,
} from "../natural-language-evaluation/delegated-retrieval-workspace.mjs";

const sourceRoot = resolve(import.meta.dirname, "../..");
const defaultSuite = resolve(sourceRoot, "benchmarks/search/delegated-retrieval-pilot-v1.json");
const linkedEvidenceSuiteIds = new Set([
  "drbench_linked_evidence_reconciliation_v8.v1",
  linkedEvidenceReconciliationConfirmationV9SuiteId,
]);
function createAdapter(provider) {
  return (repositoryRoot, model) =>
    provider === "codex"
      ? new CodexAdapter({ repositoryRoot, model, sandbox: "read-only", approvalPolicy: "never" })
      : new ClaudeAdapter({
          repositoryRoot,
          model,
          permissionMode: "dontAsk",
          tools: ["Read", "Glob", "Grep"],
        });
}

function lexicalRecommendations(corpus, query, limit) {
  const hits = new LexicalSearchIndex(corpus).search(query, limit).hits;
  const byId = new Map(corpus.map((source) => [source.sourceId, source]));
  return hits.map((hit) => {
    const source = byId.get(hit.source.sourceId);
    if (source === undefined) throw new Error("A lexical hit is absent from its source corpus.");
    return source;
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const parsed = parseArgs({
    args,
    strict: true,
    options: {
      provider: { type: "string", default: "codex" },
      model: { type: "string" },
      suite: { type: "string", default: defaultSuite },
      "dry-run": { type: "boolean" },
      output: { type: "string" },
    },
  });
  if (
    !new Set(["codex", "claude"]).has(parsed.values.provider) ||
    (!parsed.values["dry-run"] && !parsed.values.model)
  ) {
    throw new TypeError("Use --provider <codex|claude> and an explicit --model <model-id>.");
  }
  const suitePath = resolve(sourceRoot, parsed.values.suite);
  const suiteSource = JSON.parse(await readFile(suitePath, "utf8"));
  const suite =
    suiteSource.suiteId === "drbench_lexical_assisted_v2.v1"
      ? validateLexicalAssistedV2Suite(suiteSource, sourceRoot)
      : suiteSource.suiteId === "drbench_catalog_assisted_v3.v1"
        ? validateCatalogAssistedV3Suite(suiteSource, sourceRoot)
        : suiteSource.suiteId === "drbench_core_term_assisted_v4.v1"
          ? validateCoreTermAssistedV4Suite(suiteSource, sourceRoot)
          : suiteSource.suiteId === "drbench_reference_marker_assisted_v5.v1"
            ? validateReferenceMarkerAssistedV5Suite(suiteSource, sourceRoot)
            : suiteSource.suiteId === "drbench_marker_derived_paths_v6.v1"
              ? validateMarkerDerivedPathsV6Suite(suiteSource, sourceRoot)
              : suiteSource.suiteId === "drbench_staged_evidence_v7.v1"
                ? validateStagedEvidenceV7Suite(suiteSource, sourceRoot)
                : suiteSource.suiteId === "drbench_linked_evidence_reconciliation_v8.v1"
                  ? validateLinkedEvidenceReconciliationV8Suite(suiteSource, sourceRoot)
                  : suiteSource.suiteId === linkedEvidenceReconciliationConfirmationV9SuiteId
                    ? validateLinkedEvidenceReconciliationConfirmationV9Suite(
                        suiteSource,
                        sourceRoot,
                      )
                    : validateDelegatedRetrievalSuite(suiteSource, sourceRoot);
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-delegated-retrieval-"));
  const repositoryRoot = resolve(temporaryRoot, basename(sourceRoot));
  try {
    await copySanitizedEvaluationWorkspace(sourceRoot, repositoryRoot, suite);
    const project = await loadProjectManifest(repositoryRoot);
    if (parsed.values["dry-run"]) {
      const corpus = await loadDelegatedRetrievalCorpus(repositoryRoot, suite);
      const recommendations = suite.cases.map((item) => {
        const sources = lexicalRecommendations(corpus, item.query, suite.lexicalLimit);
        if (suite.suiteId === "drbench_bounded_fallback.v1") {
          validateFallbackRecommendations(item.fallbackTrigger, sources);
        }
        if (suite.suiteId === "drbench_lexical_assisted_v2.v1") {
          validateLexicalAssistedV2Recommendations(item, sources);
        }
        if (suite.suiteId === "drbench_catalog_assisted_v3.v1") {
          validateCatalogAssistedV3Recommendations(item, sources);
        }
        if (suite.suiteId === "drbench_core_term_assisted_v4.v1") {
          validateCoreTermAssistedV4Recommendations(item, sources);
        }
        if (suite.suiteId === "drbench_reference_marker_assisted_v5.v1") {
          validateReferenceMarkerAssistedV5Recommendations(item, sources);
        }
        if (suite.suiteId === "drbench_marker_derived_paths_v6.v1") {
          validateMarkerDerivedPathsV6Recommendations(item, sources);
        }
        if (suite.suiteId === "drbench_staged_evidence_v7.v1") {
          validateStagedEvidenceV7Recommendations(item, sources);
        }
        if (suite.suiteId === "drbench_linked_evidence_reconciliation_v8.v1") {
          validateLinkedEvidenceReconciliationV8Recommendations(item, sources);
        }
        if (suite.suiteId === linkedEvidenceReconciliationConfirmationV9SuiteId) {
          validateLinkedEvidenceReconciliationV8Recommendations(item, sources);
        }
        const deterministicCoverage =
          suite.suiteId === "drbench_core_term_assisted_v4.v1"
            ? buildCoreTermAssistedV4Coverage({
                corpus,
                recommendations: sources,
                query: item.query,
                coverage: suite.coverage,
                searchLexical: lexicalRecommendations,
              })
            : suite.suiteId === "drbench_reference_marker_assisted_v5.v1"
              ? buildReferenceMarkerAssistedV5Coverage({
                  corpus,
                  recommendations: sources,
                  query: item.query,
                  coverage: suite.coverage,
                  searchLexical: lexicalRecommendations,
                })
              : suite.suiteId === "drbench_marker_derived_paths_v6.v1"
                ? buildMarkerDerivedPathsV6Coverage({
                    corpus,
                    recommendations: sources,
                    query: item.query,
                    coverage: suite.coverage,
                    searchLexical: lexicalRecommendations,
                  })
                : suite.suiteId === "drbench_staged_evidence_v7.v1"
                  ? buildStagedEvidenceV7Coverage({
                      corpus,
                      recommendations: sources,
                      query: item.query,
                      coverage: suite.coverage,
                      searchLexical: lexicalRecommendations,
                    })
                  : linkedEvidenceSuiteIds.has(suite.suiteId)
                    ? buildLinkedEvidenceReconciliationV8Coverage({
                        corpus,
                        recommendations: sources,
                        query: item.query,
                        coverage: suite.coverage,
                        searchLexical: lexicalRecommendations,
                      })
                    : null;
        const linkedEvidence = linkedEvidenceSuiteIds.has(suite.suiteId)
          ? buildLinkedEvidenceReconciliationV8Expansion({
              corpus,
              recommendations: sources,
              existingPaths: [
                ...sources.map((source) => source.path),
                ...deterministicCoverage.selectedPaths,
              ],
              contract: suite.linkedEvidence,
            })
          : null;
        return {
          caseId: item.caseId,
          ...(item.fallbackTrigger === undefined ? {} : { fallbackTrigger: item.fallbackTrigger }),
          paths: sources.map((source) => source.path),
          ...(deterministicCoverage === null
            ? {}
            : {
                deterministicCoveragePaths: deterministicCoverage.selectedPaths,
                termSelections: deterministicCoverage.termSelections,
                deterministicCoverageByteCount: deterministicCoverage.byteCount,
                ...(linkedEvidence === null
                  ? {}
                  : {
                      linkedEvidencePaths: linkedEvidence.selectedPaths,
                      linkedEvidenceCandidateCount: linkedEvidence.candidateCount,
                      linkedEvidenceTruncated: linkedEvidence.truncated,
                      linkedEvidenceByteCount: linkedEvidence.byteCount,
                    }),
              }),
        };
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            corpusSources: corpus.length,
            ...(new Set(["drbench_staged_evidence_v7.v1", ...linkedEvidenceSuiteIds]).has(
              suite.suiteId,
            )
              ? {
                  noHitCatalog: (() => {
                    const catalog = linkedEvidenceSuiteIds.has(suite.suiteId)
                      ? buildLinkedEvidenceReconciliationV8NoHitCatalog(
                          corpus,
                          suite.coverage.maximumNoHitCatalogBytes,
                        )
                      : buildStagedEvidenceV7NoHitCatalog(
                          corpus,
                          suite.coverage.maximumNoHitCatalogBytes,
                        );
                    return {
                      sourceCount: catalog.entries.length,
                      byteCount: catalog.byteCount,
                      contentHash: catalog.contentHash,
                    };
                  })(),
                }
              : {}),
            recommendations,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    const runBenchmark =
      suite.suiteId === "drbench_bounded_fallback.v1"
        ? runBoundedFallbackBenchmark
        : suite.suiteId === "drbench_lexical_assisted_v2.v1"
          ? runLexicalAssistedV2Benchmark
          : suite.suiteId === "drbench_catalog_assisted_v3.v1"
            ? runCatalogAssistedV3Benchmark
            : suite.suiteId === "drbench_core_term_assisted_v4.v1"
              ? runCoreTermAssistedV4Benchmark
              : suite.suiteId === "drbench_reference_marker_assisted_v5.v1"
                ? runReferenceMarkerAssistedV5Benchmark
                : suite.suiteId === "drbench_marker_derived_paths_v6.v1"
                  ? runMarkerDerivedPathsV6Benchmark
                  : suite.suiteId === "drbench_staged_evidence_v7.v1"
                    ? runStagedEvidenceV7Benchmark
                    : suite.suiteId === "drbench_linked_evidence_reconciliation_v8.v1"
                      ? runLinkedEvidenceReconciliationV8Benchmark
                      : suite.suiteId === linkedEvidenceReconciliationConfirmationV9SuiteId
                        ? runLinkedEvidenceReconciliationConfirmationV9Benchmark
                        : runDelegatedRetrievalBenchmark;
    const report = await runBenchmark({
      suite,
      provider: parsed.values.provider,
      model: parsed.values.model,
      repositoryRoot,
      projectId: project.projectId,
      repositorySnapshot: observeRepositorySnapshot(sourceRoot),
      createAdapter: createAdapter(parsed.values.provider),
      loadCorpus: loadDelegatedRetrievalCorpus,
      searchLexical: lexicalRecommendations,
      corpusDigest: (corpus) =>
        delegatedRetrievalDigest(
          corpus.map(({ sourceId, contentHash, path }) => ({ sourceId, contentHash, path })),
        ),
      onProgress: ({ caseId, arm, repetition }) =>
        process.stderr.write(
          `${caseId} ${arm}${repetition === undefined ? "" : ` repetition=${repetition}`}\n`,
        ),
    });
    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    if (parsed.values.output === undefined) {
      process.stdout.write(serialized);
    } else {
      const outputPath = resolve(parsed.values.output);
      if (isWithinPath(outputPath, sourceRoot)) {
        throw new TypeError("Raw benchmark answers must be written outside the repository.");
      }
      await writeFile(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
      process.stdout.write(`${JSON.stringify({ outputPath, summary: report.summary }, null, 2)}\n`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
