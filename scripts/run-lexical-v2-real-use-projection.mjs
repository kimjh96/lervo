import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { executeProjectedSearch, LexicalSearchIndex } from "../packages/search/dist/index.js";
import { LexicalV2SearchIndex } from "../packages/search-adapter-lexical-v2/dist/index.js";
import { openProjectStorage } from "../packages/project-storage/dist/index.js";
import {
  canonicalJson,
  scanConfiguredRepositoryKnowledge,
  sha256,
} from "../packages/repository-knowledge/dist/index.js";
import { collectLocalKnowledgeSources } from "../apps/cli/dist/knowledge-sources.js";
import { prepareProcessSearchQueryProjector } from "../apps/cli/dist/provider-query-projector.js";
import { createRepositoryKnowledgeSearchCorpus } from "../apps/cli/dist/repository-search-corpus.js";
import { createCurrentWorkstreamSearchProjectionContext } from "../apps/cli/dist/search-projection-context.js";
import { verifiedCurrentWorkstream } from "../apps/cli/dist/workstream-services.js";
import { validateLexicalV2RealUseReview } from "./natural-language-evaluation/lexical-v2-real-use-review-contract.mjs";

const repositoryRoot = new URL("..", import.meta.url).pathname.replace(/\/$/u, "");
const suitePath = `${repositoryRoot}/benchmarks/search/lexical-v2-real-use-reviewed-v1.json`;

function expectedRanks(item, execution) {
  const rankByPath = new Map(
    execution.hits.map((hit) => [hit.source.path ?? hit.source.sourceId, hit.rank]),
  );
  return item.expectedPaths.map((path) => ({ path, rank: rankByPath.get(path) ?? null }));
}

function passed(item, ranks) {
  const matches = ranks.map(({ rank }) => rank !== null && rank <= item.maximumRank);
  return item.matchPolicy === "all" ? matches.every(Boolean) : matches.some(Boolean);
}

async function currentWorkstreamContext() {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const workstream = await verifiedCurrentWorkstream(storage);
    if (workstream === null) throw new TypeError("A current verified workstream is required.");
    return { workstream };
  } finally {
    await storage.close();
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === "--") arguments_.shift();
  const parsed = parseArgs({
    args: arguments_,
    strict: true,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      repetitions: { type: "string", default: "1" },
      "summary-only": { type: "boolean", default: false },
    },
  });
  if (!new Set(["codex", "claude"]).has(parsed.values.provider)) {
    throw new TypeError(
      "Use --provider <codex|claude> [--model <model-id>] [--repetitions <1-5>].",
    );
  }
  const repetitions = Number(parsed.values.repetitions);
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 5) {
    throw new TypeError("--repetitions must be an integer from 1 through 5.");
  }
  const suite = validateLexicalV2RealUseReview(
    JSON.parse(await readFile(suitePath, "utf8")),
    repositoryRoot,
  );
  const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
  const { scan, policy } = await scanConfiguredRepositoryKnowledge(repositoryRoot, {
    supplementalSources,
  });
  const corpusProjection = createRepositoryKnowledgeSearchCorpus(scan);
  const corpus = corpusProjection.sources;
  const indexes = {
    lexical_v1: new LexicalSearchIndex(corpus),
    lexical_v2: new LexicalV2SearchIndex(corpus),
  };
  const { workstream } = await currentWorkstreamContext();
  const currentSearchProjectionContext = createCurrentWorkstreamSearchProjectionContext(workstream);
  const preparedProjector = await prepareProcessSearchQueryProjector(parsed.values.provider, {
    timeoutMs: 20_000,
    onFailure: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`query projection failed: ${message}\n`);
    },
    ...(parsed.values.model === undefined ? {} : { model: parsed.values.model }),
  });
  const projector = preparedProjector.projector;
  try {
    const cases = [];
    for (const item of suite.cases) {
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        const contextAnchors =
          item.contextRequirement === "current_workstream"
            ? currentSearchProjectionContext.contextAnchors
            : [];
        const projectionContext =
          item.contextRequirement === "current_workstream"
            ? currentSearchProjectionContext.context
            : { contextRequirement: "none" };
        const projection = await projector.project({
          request: item.query,
          requestDigest: sha256(item.query),
          context: projectionContext,
          contextDigest: sha256(canonicalJson(projectionContext)),
          contextAnchors,
          requestedLanguage: policy.publication.language,
        });
        const arms = {};
        if (projection.receipt.status === "completed") {
          for (const [arm, index] of Object.entries(indexes)) {
            const startedAt = Date.now();
            const execution = await executeProjectedSearch({
              projection,
              index,
              perQueryLimit: 50,
              finalLimit: 50,
              fusionPolicy: "query_coverage_interleave",
            });
            const ranks = expectedRanks(item, execution);
            arms[arm] = {
              passed: passed(item, ranks),
              expectedRanks: ranks,
              durationMs: Date.now() - startedAt,
              resultSetHash: execution.resultSetHash,
              fusionResultDigest: execution.fusion.resultDigest,
            };
          }
        }
        cases.push({
          caseId: item.caseId,
          repetition,
          projectionReceipt: projection.receipt,
          arms,
        });
      }
    }
    const projectionDurations = cases.map((item) => item.projectionReceipt.durationMs);
    const observedUsage = cases
      .map((item) => item.projectionReceipt.usage)
      .filter((usage) => usage !== undefined);
    const core = {
      schemaVersion: 1,
      suiteId: suite.suiteId,
      suiteBindingHash: suite.review.bindingHash,
      provider: parsed.values.provider,
      model: parsed.values.model ?? "provider_default",
      repetitions,
      workstreamId: workstream.workstreamId,
      workstreamRevision: workstream.revision,
      sourceSnapshotId: scan.snapshotId,
      corpusDigest: corpusProjection.digest,
      corpusDocumentCount: corpusProjection.documentCount,
      corpusByteCount: corpusProjection.byteCount,
      privacy: {
        requestText: "excluded",
        contextText: "excluded",
        projectedQueryText: "excluded",
      },
      projectorAdmission: preparedProjector.admission,
      cases,
      acceptance: {
        lexicalV1PassedCases: cases.filter((item) => item.arms.lexical_v1?.passed).length,
        lexicalV2PassedCases: cases.filter((item) => item.arms.lexical_v2?.passed).length,
        lexicalV2CasesPassingEveryRepetition: suite.cases.filter((suiteCase) =>
          cases
            .filter((item) => item.caseId === suiteCase.caseId)
            .every((item) => item.arms.lexical_v2?.passed === true),
        ).length,
        allProjectionReceiptsCompleted: cases.every(
          (item) => item.projectionReceipt.status === "completed",
        ),
        allProjectionUsageObserved: observedUsage.length === cases.length,
        maximumProjectionDurationMs: Math.max(...projectionDurations),
        projectionDurationLimitMs: 20_000,
        allProjectionDurationsWithinLimit: projectionDurations.every(
          (duration) => duration <= 20_000,
        ),
        totalProjectionTokens: observedUsage.reduce((sum, usage) => sum + usage.totalTokens, 0),
        meanProjectionTokens:
          observedUsage.length === 0
            ? null
            : Math.round(
                observedUsage.reduce((sum, usage) => sum + usage.totalTokens, 0) /
                  observedUsage.length,
              ),
        lexicalV2AllCasesPassed: cases.every((item) => item.arms.lexical_v2?.passed === true),
      },
    };
    const report = {
      reportId: `lv2real_${createHash("sha256").update(canonicalJson(core)).digest("hex").slice(0, 24)}`,
      ...core,
    };
    const serialized = JSON.stringify(report, null, 2);
    if (suite.cases.some((item) => serialized.includes(item.query))) {
      throw new TypeError("The real-use projection report retained private query text.");
    }
    if (parsed.values["summary-only"]) {
      const summary = {
        reportId: report.reportId,
        reportSha256: sha256(serialized),
        suiteId: report.suiteId,
        suiteBindingHash: report.suiteBindingHash,
        provider: report.provider,
        model: report.model,
        repetitions: report.repetitions,
        sourceSnapshotId: report.sourceSnapshotId,
        corpusDigest: report.corpusDigest,
        corpusDocumentCount: report.corpusDocumentCount,
        corpusByteCount: report.corpusByteCount,
        projectorBuildIds: [
          ...new Set(cases.map((item) => item.projectionReceipt.projector.buildId)),
        ],
        projectorAdmission: report.projectorAdmission,
        observations: cases.map((item) => ({
          caseId: item.caseId,
          repetition: item.repetition,
          projectionReceiptId: item.projectionReceipt.receiptId,
          projectionStatus: item.projectionReceipt.status,
          projectedQueryCount: item.projectionReceipt.projectedQueryCount,
          projectionDurationMs: item.projectionReceipt.durationMs,
          projectionTotalTokens: item.projectionReceipt.usage?.totalTokens ?? null,
          lexicalV1Passed: item.arms.lexical_v1?.passed ?? false,
          lexicalV1ExpectedRanks: item.arms.lexical_v1?.expectedRanks ?? [],
          lexicalV2Passed: item.arms.lexical_v2?.passed ?? false,
          lexicalV2ExpectedRanks: item.arms.lexical_v2?.expectedRanks ?? [],
        })),
        acceptance: report.acceptance,
      };
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      process.stdout.write(`${serialized}\n`);
    }
  } finally {
    await preparedProjector.close();
  }
}

await main();
