import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import { ClaudeAdapter } from "../../../packages/adapter-claude/dist/index.js";
import { CodexAdapter } from "../../../packages/adapter-codex/dist/index.js";
import { loadProjectManifest } from "../../../packages/project/dist/index.js";
import { LexicalV2SearchIndex } from "../../../packages/search-adapter-lexical-v2/dist/index.js";
import { LexicalSearchIndex } from "../../../packages/search/dist/index.js";

import { delegatedRetrievalDigest } from "../../natural-language-evaluation/delegated-retrieval-contract.mjs";
import { runDelegatedRetrievalArm } from "../../natural-language-evaluation/delegated-retrieval-runner.mjs";
import {
  lexicalV2ProviderBaseInstructions,
  lexicalV2ProviderOutputSchema,
  lexicalV2ProviderOutputSchemaV2,
  lexicalV2ProviderProtocol,
  lexicalV2ProviderProtocolV2,
  lexicalV2ProviderProtocolV3,
  lexicalV2ProviderProtocolV4,
  lexicalV2ProviderProtocolV5,
  lexicalV2ProviderProtocolV6,
  lexicalV2ProviderProtocolV7,
  lexicalV2ProviderProtocolV8,
  validateLexicalV2ProviderSuite,
} from "../../natural-language-evaluation/lexical-v2-provider-comparison-contract.mjs";
import { selectSectionEvidence } from "../../natural-language-evaluation/section-evidence-selector.mjs";
import { selectEvidenceRecommendations } from "../../natural-language-evaluation/evidence-retrieval-pipeline.mjs";
import { createLexicalV2ProviderReport } from "../../natural-language-evaluation/lexical-v2-provider-report.mjs";
import { prepareLexicalV2ProviderAdapter } from "../../natural-language-evaluation/lexical-v2-provider-preparation.mjs";
import {
  copySanitizedEvaluationWorkspace,
  loadDelegatedRetrievalCorpus,
  observeRepositorySnapshot,
} from "../../natural-language-evaluation/delegated-retrieval-workspace.mjs";

const sourceRoot = resolve(import.meta.dirname, "../../..");
const defaultSuite = resolve(
  sourceRoot,
  "benchmarks/search/lexical-v2-provider-comparison-v1.json",
);

async function loadProviderSuite(suitePath, seen = new Set()) {
  const absolutePath = resolve(sourceRoot, suitePath);
  if (seen.has(absolutePath)) throw new TypeError("Provider suite inheritance is cyclic.");
  const nextSeen = new Set(seen).add(absolutePath);
  const value = JSON.parse(await readFile(absolutePath, "utf8"));
  if (value.baseSuite === undefined) return value;
  const base = await loadProviderSuite(value.baseSuite, nextSeen);
  return {
    ...base,
    ...value,
    ...(value.additionalCases === undefined
      ? {}
      : { cases: [...base.cases, ...value.additionalCases] }),
  };
}

function createAdapter(
  provider,
  repositoryRoot,
  model,
  structuredOutputSchema,
  reasoningEffort,
  baseInstructions,
) {
  return provider === "codex"
    ? new CodexAdapter({
        repositoryRoot,
        model,
        ...(baseInstructions === undefined ? {} : { baseInstructions }),
        sandbox: "read-only",
        approvalPolicy: "never",
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
      })
    : new ClaudeAdapter({
        repositoryRoot,
        model,
        ...(baseInstructions === undefined ? {} : { systemPrompt: baseInstructions }),
        permissionMode: "plan",
        tools: [],
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
      });
}

function recommendations(index, byId, item, limit) {
  return index.search(item.query, limit).hits.map((hit) => {
    const source = byId.get(hit.source.sourceId);
    if (source === undefined) throw new Error("A ranked source is absent from the corpus.");
    return source;
  });
}

function pipelineRecommendations(index, byId, byPath, item, evidenceDelivery) {
  const ranked = recommendations(index, byId, item, 30);
  return selectEvidenceRecommendations(ranked, item.query, byPath, {
    anchorLimit: evidenceDelivery.anchorDocuments ?? 3,
    linkedExpansionLimit: evidenceDelivery.linkedExpansionDocuments ?? 2,
    focusedExpansionLimit: evidenceDelivery.focusedSpecificationDocuments ?? 1,
    linkedExpansionBeforeSecondaryAnchors:
      evidenceDelivery.linkedExpansionBeforeSecondaryAnchors ?? false,
  }).slice(0, evidenceDelivery.candidateMaximumDocuments);
}

function candidateEvidenceSelector(selected, evidenceDelivery) {
  const primaryPath = selected[0]?.path;
  return (source, query) => {
    const sourceBytes = Buffer.byteLength(source.text, "utf8");
    if (
      source.path === primaryPath &&
      sourceBytes <= (evidenceDelivery.primaryDocumentFullTextMaximumBytes ?? 0)
    ) {
      return {
        content: source.text,
        contentHash: source.contentHash,
        byteCount: sourceBytes,
        scope: { kind: "full" },
        sourceContentHash: source.contentHash,
        selectionScore: 0,
      };
    }
    return selectSectionEvidence(source, query, {
      maximumSections: evidenceDelivery.maximumSectionsPerDocument,
      targetBytes: evidenceDelivery.targetBytesPerDocument,
    });
  };
}

function failureCode(error) {
  if (
    error !== null &&
    typeof error === "object" &&
    typeof error.failureCode === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/u.test(error.failureCode)
  ) {
    return error.failureCode;
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timed out")) return "provider_timeout";
  if (message.includes("JSON object") || message.includes("answer contract")) {
    return "provider_result_invalid";
  }
  return "provider_execution_failed";
}

async function runArm(input) {
  const startedAt = Date.now();
  try {
    const result = await runDelegatedRetrievalArm(input);
    const permittedPaths = new Set(input.recommendations.map((source) => source.path));
    const suppliedPathContract = result.sourcePaths.every((path) => permittedPaths.has(path));
    const toolIsolated = result.completedToolCalls === 0 && result.completedCommands === 0;
    const responseBound =
      input.responseContract === undefined ||
      (Array.from(result.answer).length <= input.responseContract.maximumAnswerCharacters &&
        result.sourcePaths.length <= input.responseContract.maximumSourcePaths);
    const passedContract =
      result.passedContract && suppliedPathContract && toolIsolated && responseBound;
    const { answer: _answer, ...bounded } = result;
    return {
      ...bounded,
      passedContract,
      suppliedPathContract,
      toolIsolated,
      responseBound,
      answerCharacters: Array.from(result.answer).length,
      sourcePathCount: result.sourcePaths.length,
      passed: result.answerPassed && passedContract && result.providerErrors === 0,
      injectedBytes: result.injectedRecommendationBytes,
      structuredOutputRequested: input.structuredOutputSchema !== undefined,
      reasoningEffort: input.reasoningEffort ?? "provider_default",
      executionWorkspace: input.executionWorkspace ?? "sanitized_repository",
      ...(input.providerPreparationDurationMs === undefined
        ? {}
        : { providerPreparationDurationMs: input.providerPreparationDurationMs }),
      ...(input.providerPreparationStrategy === undefined
        ? {}
        : { providerPreparationStrategy: input.providerPreparationStrategy }),
    };
  } catch (error) {
    const failureDetail = (error instanceof Error ? error.message : String(error))
      .replaceAll(input.repositoryRoot, "<repository>")
      .slice(0, 500);
    return {
      arm: input.arm,
      passedContract: false,
      suppliedPathContract: false,
      toolIsolated: false,
      responseBound: false,
      answerCharacters: 0,
      sourcePathCount: 0,
      passed: false,
      answerPassed: false,
      expectedPathRecall: 0,
      returnedPathPrecision: 0,
      abstained: false,
      durationMs: Date.now() - startedAt,
      completedToolCalls: 0,
      completedCommands: 0,
      providerErrors: 1,
      providerErrorCounts: { [failureCode(error)]: 1 },
      usage: null,
      injectedBytes: input.recommendations.reduce((sum, source) => {
        const evidence = input.evidenceSelector?.(source, input.item.query);
        return sum + (evidence?.byteCount ?? Buffer.byteLength(source.text, "utf8"));
      }, 0),
      structuredOutputRequested: input.structuredOutputSchema !== undefined,
      reasoningEffort: input.reasoningEffort ?? "provider_default",
      executionWorkspace: input.executionWorkspace ?? "sanitized_repository",
      ...(input.providerPreparationDurationMs === undefined
        ? {}
        : { providerPreparationDurationMs: input.providerPreparationDurationMs }),
      ...(input.providerPreparationStrategy === undefined
        ? {}
        : { providerPreparationStrategy: input.providerPreparationStrategy }),
      failureCode: failureCode(error),
      failureDetail,
    };
  }
}

export async function runLexicalV2ProviderComparison() {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const parsed = parseArgs({
    args,
    strict: true,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      suite: { type: "string", default: defaultSuite },
      "dry-run": { type: "boolean" },
    },
  });
  if (
    !new Set(["codex", "claude"]).has(parsed.values.provider) ||
    (!parsed.values["dry-run"] && !parsed.values.model)
  ) {
    throw new TypeError("Use --provider <codex|claude> and --model <model-id>.");
  }
  const suiteValue = await loadProviderSuite(parsed.values.suite);
  const suite = validateLexicalV2ProviderSuite(suiteValue, sourceRoot);
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "lervo-lexical-v2-provider-"));
  const repositoryRoot = resolve(temporaryRoot, basename(sourceRoot));
  const evidenceOnlyRoot = resolve(temporaryRoot, "evidence-only");
  try {
    await copySanitizedEvaluationWorkspace(sourceRoot, repositoryRoot, suite);
    await mkdir(evidenceOnlyRoot);
    const project = await loadProjectManifest(repositoryRoot);
    const corpus = await loadDelegatedRetrievalCorpus(repositoryRoot, suite);
    const byId = new Map(corpus.map((source) => [source.sourceId, source]));
    const byPath = new Map(corpus.map((source) => [source.path, source]));
    const indexes = {
      lexical_v1: new LexicalSearchIndex(corpus),
      lexical_v2: new LexicalV2SearchIndex(corpus),
    };
    const pipelineComparison = suite.schemaVersion >= 2;
    const structuredOutputSchema = pipelineComparison
      ? suite.schemaVersion >= 17
        ? lexicalV2ProviderOutputSchemaV2
        : lexicalV2ProviderOutputSchema
      : undefined;
    const protocol =
      suite.schemaVersion >= 16
        ? lexicalV2ProviderProtocolV8
        : suite.schemaVersion >= 15
          ? lexicalV2ProviderProtocolV7
          : suite.schemaVersion >= 11
            ? lexicalV2ProviderProtocolV6
            : suite.schemaVersion >= 10
              ? lexicalV2ProviderProtocolV5
              : suite.schemaVersion >= 8
                ? lexicalV2ProviderProtocolV4
                : suite.schemaVersion >= 7
                  ? lexicalV2ProviderProtocolV3
                  : suite.schemaVersion >= 6
                    ? lexicalV2ProviderProtocolV2
                    : lexicalV2ProviderProtocol;
    if (parsed.values["dry-run"]) {
      const selections = suite.cases.map((item) => ({
        caseId: item.caseId,
        arms: Object.fromEntries(
          Object.entries(indexes).map(([arm, index]) => {
            const selected =
              pipelineComparison && arm === "lexical_v2"
                ? pipelineRecommendations(index, byId, byPath, item, suite.evidenceDelivery)
                : recommendations(index, byId, item, suite.lexicalLimit);
            const evidenceSelector =
              pipelineComparison && arm === "lexical_v2"
                ? candidateEvidenceSelector(selected, suite.evidenceDelivery)
                : undefined;
            return [
              arm,
              {
                paths: selected.map((source) => source.path),
                bytes: selected.reduce((sum, source) => {
                  const evidence = evidenceSelector?.(source, item.query);
                  return sum + (evidence?.byteCount ?? Buffer.byteLength(source.text, "utf8"));
                }, 0),
              },
            ];
          }),
        ),
      }));
      const baselineBytes = selections.reduce((sum, item) => sum + item.arms.lexical_v1.bytes, 0);
      const candidateBytes = selections.reduce((sum, item) => sum + item.arms.lexical_v2.bytes, 0);
      const injectedByteRatioBasisPoints = Math.round((candidateBytes / baselineBytes) * 10_000);
      const expectedPathCoverage = selections.every((selection) => {
        const item = suite.cases.find((candidate) => candidate.caseId === selection.caseId);
        return item.expectedPaths.every((path) => selection.arms.lexical_v2.paths.includes(path));
      });
      const candidateDocumentBound = selections.every(
        (selection) =>
          selection.arms.lexical_v2.paths.length <=
          (suite.evidenceDelivery?.candidateMaximumDocuments ?? suite.lexicalLimit),
      );
      const criteria = {
        expectedPathCoverage,
        candidateDocumentBound,
        injectedByteRatio:
          !pipelineComparison ||
          injectedByteRatioBasisPoints <= suite.acceptance.maximumInjectedByteRatioBasisPoints,
      };
      process.stdout.write(
        `${JSON.stringify(
          {
            suiteId: suite.suiteId,
            suiteDigest: delegatedRetrievalDigest(suite),
            reasoningEffort: suite.reasoningEffort ?? {
              baseline: "provider_default",
              candidate: "provider_default",
            },
            corpusSources: corpus.length,
            selections,
            providerFreeAcceptance: {
              passed: Object.values(criteria).every(Boolean),
              criteria,
              observed: { baselineBytes, candidateBytes, injectedByteRatioBasisPoints },
            },
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    const arms = ["lexical_v1", "lexical_v2"];
    const jobs = [];
    for (let repetition = 1; repetition <= suite.repetitionsPerArm; repetition += 1) {
      for (const [caseIndex, item] of suite.cases.entries()) {
        const offset = (caseIndex + repetition - 1) % arms.length;
        const order = [...arms.slice(offset), ...arms.slice(0, offset)];
        jobs.push(...order.map((arm) => ({ repetition, item, arm, order })));
      }
    }
    const jobRuntime = (job) => {
      const executionWorkspace =
        suite.schemaVersion >= 4 && job.arm === "lexical_v2"
          ? "empty_evidence_only_directory"
          : "sanitized_repository";
      const reasoningEffort =
        job.arm === "lexical_v1"
          ? suite.reasoningEffort?.baseline
          : suite.reasoningEffort?.candidate;
      const root =
        executionWorkspace === "empty_evidence_only_directory" ? evidenceOnlyRoot : repositoryRoot;
      return { executionWorkspace, reasoningEffort, root };
    };
    const prepareJob = (job) => {
      const runtime = jobRuntime(job);
      return prepareLexicalV2ProviderAdapter({
        provider: parsed.values.provider,
        repositoryRoot: runtime.root,
        model: parsed.values.model,
        structuredOutputSchema,
        reasoningEffort: runtime.reasoningEffort,
      });
    };
    const runs = [];
    const providerPreparationStrategy =
      suite.schemaVersion >= 19
        ? parsed.values.provider === "claude"
          ? "serialized_warm_admission"
          : "rolling_isolated_prewarm"
        : "rolling_isolated_prewarm";
    let preparedPromise = suite.schemaVersion >= 17 ? prepareJob(jobs[0]) : undefined;
    for (const [jobIndex, job] of jobs.entries()) {
      const { repetition, item, arm, order } = job;
      const runtime = jobRuntime(job);
      const prepared = preparedPromise === undefined ? undefined : await preparedPromise;
      preparedPromise =
        suite.schemaVersion >= 17 &&
        providerPreparationStrategy === "rolling_isolated_prewarm" &&
        jobIndex + 1 < jobs.length
          ? prepareJob(jobs[jobIndex + 1])
          : undefined;
      let run = runs.at(-1);
      if (run?.caseId !== item.caseId || run.repetition !== repetition) {
        run = {
          caseId: item.caseId,
          taskType: item.taskType,
          repetition,
          armOrder: order,
          arms: {},
        };
        runs.push(run);
      }
      process.stderr.write(
        `[${parsed.values.provider}] repetition=${repetition} case=${item.caseId} arm=${arm}\n`,
      );
      const selected =
        pipelineComparison && arm === "lexical_v2"
          ? pipelineRecommendations(indexes[arm], byId, byPath, item, suite.evidenceDelivery)
          : recommendations(indexes[arm], byId, item, suite.lexicalLimit);
      const evidenceSelector =
        pipelineComparison && arm === "lexical_v2"
          ? candidateEvidenceSelector(selected, suite.evidenceDelivery)
          : undefined;
      run.arms[arm] = await runArm({
        arm,
        item,
        recommendations: selected,
        protocol,
        repositoryRoot: runtime.root,
        projectId: project.projectId,
        provider: parsed.values.provider,
        model: parsed.values.model,
        evidenceSelector,
        structuredOutputSchema,
        responseContract: suite.responseContract,
        reasoningEffort: runtime.reasoningEffort,
        executionWorkspace: runtime.executionWorkspace,
        ...(prepared === undefined
          ? {}
          : {
              preparedAdapter: prepared.adapter,
              providerPreparationDurationMs: prepared.durationMs,
              providerPreparationStrategy,
            }),
        createAdapter: (root, model) =>
          createAdapter(
            parsed.values.provider,
            root,
            model,
            structuredOutputSchema,
            runtime.reasoningEffort,
            suite.schemaVersion === 16 ? lexicalV2ProviderBaseInstructions : undefined,
          ),
      });
      if (
        suite.schemaVersion >= 19 &&
        providerPreparationStrategy === "serialized_warm_admission" &&
        jobIndex + 1 < jobs.length
      ) {
        preparedPromise = prepareJob(jobs[jobIndex + 1]);
      }
    }
    const report = createLexicalV2ProviderReport({
      suiteId: suite.suiteId,
      suiteDigest: delegatedRetrievalDigest(suite),
      provider: parsed.values.provider,
      model: parsed.values.model,
      repositorySnapshot: observeRepositorySnapshot(sourceRoot),
      corpusDigest: delegatedRetrievalDigest(
        corpus.map(({ sourceId, contentHash, path }) => ({ sourceId, contentHash, path })),
      ),
      observedAt: new Date().toISOString(),
      acceptance: suite.acceptance,
      runs,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
