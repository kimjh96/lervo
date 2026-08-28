import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import { ClaudeAdapter } from "../packages/adapter-claude/dist/index.js";
import { CodexAdapter } from "../packages/adapter-codex/dist/index.js";
import { loadProjectManifest } from "../packages/project/dist/index.js";
import { LexicalSearchIndex } from "../packages/search/dist/index.js";

import {
  delegatedRetrievalDigest,
  validateDelegatedRetrievalSuite,
} from "./natural-language-evaluation/delegated-retrieval-contract.mjs";
import { runDelegatedRetrievalBenchmark } from "./natural-language-evaluation/delegated-retrieval-runner.mjs";
import {
  runBoundedFallbackBenchmark,
  validateFallbackRecommendations,
} from "./natural-language-evaluation/bounded-retrieval-runner.mjs";
import {
  validateLexicalAssistedV2Recommendations,
  validateLexicalAssistedV2Suite,
} from "./natural-language-evaluation/lexical-assisted-v2-contract.mjs";
import { runLexicalAssistedV2Benchmark } from "./natural-language-evaluation/lexical-assisted-v2-runner.mjs";
import {
  copySanitizedEvaluationWorkspace,
  isWithinPath,
  loadDelegatedRetrievalCorpus,
  observeRepositorySnapshot,
} from "./natural-language-evaluation/delegated-retrieval-workspace.mjs";

const sourceRoot = resolve(import.meta.dirname, "..");
const defaultSuite = resolve(sourceRoot, "benchmarks/search/delegated-retrieval-pilot-v1.json");
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
      : validateDelegatedRetrievalSuite(suiteSource, sourceRoot);
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-delegated-retrieval-"));
  const repositoryRoot = resolve(temporaryRoot, basename(sourceRoot));
  try {
    await copySanitizedEvaluationWorkspace(sourceRoot, repositoryRoot);
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
        return {
          caseId: item.caseId,
          ...(item.fallbackTrigger === undefined ? {} : { fallbackTrigger: item.fallbackTrigger }),
          paths: sources.map((source) => source.path),
        };
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            corpusSources: corpus.length,
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
