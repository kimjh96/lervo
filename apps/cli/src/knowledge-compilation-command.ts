import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  canonicalJson,
  compareKnowledgeCompilationCandidates,
  compileRepositoryKnowledgeCandidate,
  createCrossProviderExactMergeCandidate,
  createCrossProviderFuzzyMergeCandidate,
  observeKnowledgeCompilationStability,
  runKnowledgeCompilationStabilityGate,
  scanConfiguredRepositoryKnowledge,
  sha256,
  storeKnowledgeCompilationCandidate,
} from "@lervo/repository-knowledge";
import { createProcessSemanticCompiler } from "@lervo/repository-knowledge-compiler";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo } from "./types.js";

type CompilationOperation =
  "compile" | "compare" | "stability" | "merge-candidate" | "fuzzy-merge-candidate";

async function compile(args: string[], io: CliIo, usage: string): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      executable: { type: "string" },
      "timeout-ms": { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (parsed.values.help) {
    io.stdout(`${usage}\n`);
    return 0;
  }
  if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude") {
    throw new Error("--provider must be codex or claude.");
  }
  const timeoutMs =
    parsed.values["timeout-ms"] === undefined ? undefined : Number(parsed.values["timeout-ms"]);
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000)
  ) {
    throw new Error("--timeout-ms must be an integer between 1000 and 600000.");
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  const compiler = await createProcessSemanticCompiler({
    provider: parsed.values.provider,
    ...(parsed.values.model === undefined ? {} : { model: parsed.values.model }),
    ...(parsed.values.executable === undefined ? {} : { executable: parsed.values.executable }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const supplementalSources = await collectLocalKnowledgeSources(root);
  const { policy, scan } = await scanConfiguredRepositoryKnowledge(root, { supplementalSources });
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("semantic compilation cancelled"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const candidate = await compileRepositoryKnowledgeCandidate({
      scan,
      policyHash: sha256(canonicalJson(policy)),
      compiler,
      signal: controller.signal,
      outputLanguage: policy.publication.language,
    });
    const receipt = await storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate });
    const result = {
      receipt,
      compiler: candidate.compiler,
      coverage: candidate.coverage,
      concepts: candidate.concepts.length,
      relations: candidate.relations.length,
    };
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Semantic knowledge candidate ${receipt.created ? "created" : "reused"}.\nprovider: ${candidate.compiler.provider} · ${candidate.compiler.compilerVersion}\ncompilation: ${candidate.compilationId}\ncoverage: shard ${candidate.coverage.compiledShardCount}/${candidate.coverage.shardCount}, unit ${candidate.coverage.unitCount}\ncandidate: concept ${candidate.concepts.length}, relation ${candidate.relations.length} · assurance unreviewed\nartifact: ${receipt.artifactPath}\n`,
    );
    return 0;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

async function compare(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      codex: { type: "string" },
      claude: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (parsed.values.codex === undefined || parsed.values.claude === undefined)
    throw new Error("compare requires both --codex and --claude compilation IDs.");
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
  const result = await compareKnowledgeCompilationCandidates({
    repositoryRoot,
    codexCompilationId: parsed.values.codex,
    claudeCompilationId: parsed.values.claude,
    supplementalSources,
  });
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `Codex-Claude semantic comparison: ${result.status}\ncomparison: ${result.comparisonId}\nconcepts: Codex ${result.concepts.codexCount} · Claude ${result.concepts.claudeCount} · exact shared ${result.concepts.exactSharedSignatureCount}\nclaims: Codex ${result.claims.codexCount} · Claude ${result.claims.claudeCount} · exact shared ${result.claims.exactSharedSignatureCount}\nrelations: Codex ${result.relations.codexCount} · Claude ${result.relations.claudeCount} · exact shared ${result.relations.exactSharedSignatureCount}\nOnly exact digest overlap was compared; this is not evidence of truth, agreement, review, or use.\n`,
  );
  return 0;
}

async function stability(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      baseline: { type: "string" },
      candidate: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      executable: { type: "string" },
      "timeout-ms": { type: "string" },
      json: { type: "boolean" },
    },
  });
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
  const storedComparison =
    parsed.values.baseline !== undefined || parsed.values.candidate !== undefined;
  const liveGate = parsed.values.provider !== undefined;
  if (storedComparison === liveGate)
    throw new Error(
      "stability requires either a --provider live gate or a stored --baseline/--candidate comparison.",
    );
  if (
    storedComparison &&
    (parsed.values.baseline === undefined || parsed.values.candidate === undefined)
  )
    throw new Error("Stored candidate comparison requires both --baseline and --candidate.");
  if (storedComparison) {
    const result = await observeKnowledgeCompilationStability({
      repositoryRoot,
      baselineCompilationId: parsed.values.baseline!,
      candidateCompilationId: parsed.values.candidate!,
      supplementalSources,
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Semantic candidate stability: ${result.status}\nobservation: ${result.observationId}\nprovider: ${result.provider} · build ${result.compilerBuildId}\nbaseline: ${result.baseline.compilationId} · ${result.baseline.semanticDigest}\ncandidate: ${result.candidate.compilationId} · ${result.candidate.semanticDigest}\nOnly the two stored candidate artifacts were compared; this is not evidence of replay, truth, review, or use.\n`,
    );
    return 0;
  }
  if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude")
    throw new Error("--provider must be codex or claude.");
  const timeoutMs =
    parsed.values["timeout-ms"] === undefined ? undefined : Number(parsed.values["timeout-ms"]);
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000)
  )
    throw new Error("--timeout-ms must be an integer between 1000 and 600000.");
  const compiler = await createProcessSemanticCompiler({
    provider: parsed.values.provider,
    ...(parsed.values.model === undefined ? {} : { model: parsed.values.model }),
    ...(parsed.values.executable === undefined ? {} : { executable: parsed.values.executable }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const { policy, scan } = await scanConfiguredRepositoryKnowledge(repositoryRoot, {
    supplementalSources,
  });
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("semantic stability gate cancelled"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  let gated;
  try {
    gated = await runKnowledgeCompilationStabilityGate({
      scan,
      policyHash: sha256(canonicalJson(policy)),
      compiler,
      signal: controller.signal,
    });
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
  const receipts = await Promise.all([
    storeKnowledgeCompilationCandidate({ repositoryRoot, candidate: gated.baseline }),
    storeKnowledgeCompilationCandidate({ repositoryRoot, candidate: gated.candidate }),
  ]);
  const output = { observation: gated.observation, receipts };
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify(output, null, 2)}\n`
      : `Live semantic compiler stability gate: ${gated.observation.status}\nobservation: ${gated.observation.observationId}\nprovider: ${gated.observation.provider} · build ${gated.observation.compilerBuildId}\nTwo compile calls were observed to complete. This establishes output stability only, not truth, review, or use.\n`,
  );
  return 0;
}

async function mergeCandidate(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      comparison: { type: "string" },
      codex: { type: "string" },
      claude: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (
    parsed.values.comparison === undefined ||
    parsed.values.codex === undefined ||
    parsed.values.claude === undefined
  ) {
    throw new Error("merge-candidate requires --comparison, --codex, and --claude.");
  }
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
  const result = await createCrossProviderExactMergeCandidate({
    repositoryRoot,
    codexCompilationId: parsed.values.codex,
    claudeCompilationId: parsed.values.claude,
    comparisonId: parsed.values.comparison,
    supplementalSources,
  });
  const receipt = await storeKnowledgeCompilationCandidate({
    repositoryRoot,
    candidate: result.candidate,
  });
  const output = {
    receipt,
    comparisonId: result.comparison.comparisonId,
    derivation: result.candidate.derivation,
    coverage: result.candidate.coverage,
    concepts: result.candidate.concepts.length,
    relations: result.candidate.relations.length,
  };
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify(output, null, 2)}\n`
      : `Cross-provider exact-overlap candidate ${receipt.created ? "created" : "reused"}.\ncomparison: ${result.comparison.comparisonId}\ncompilation: ${receipt.compilationId}\ncandidate: concept ${result.candidate.concepts.length}, relation ${result.candidate.relations.length} · assurance unreviewed\nThis candidate is bound only to the two source artifacts and still requires the existing reconcile → human review → materialize process.\n`,
  );
  return 0;
}

async function fuzzyMergeCandidate(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      comparison: { type: "string" },
      codex: { type: "string" },
      claude: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (
    parsed.values.comparison === undefined ||
    parsed.values.codex === undefined ||
    parsed.values.claude === undefined
  ) {
    throw new Error("fuzzy-merge-candidate requires --comparison, --codex, and --claude.");
  }
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
  const result = await createCrossProviderFuzzyMergeCandidate({
    repositoryRoot,
    codexCompilationId: parsed.values.codex,
    claudeCompilationId: parsed.values.claude,
    comparisonId: parsed.values.comparison,
    supplementalSources,
  });
  const receipt = await storeKnowledgeCompilationCandidate({
    repositoryRoot,
    candidate: result.candidate,
  });
  const output = {
    receipt,
    comparisonId: result.comparison.comparisonId,
    derivation: result.candidate.derivation,
    coverage: result.candidate.coverage,
    matches: result.matches,
    concepts: result.candidate.concepts.length,
    relations: result.candidate.relations.length,
  };
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify(output, null, 2)}\n`
      : `Approval-gated fuzzy candidate ${receipt.created ? "created" : "reused"}.\ncomparison: ${result.comparison.comparisonId}\ncompilation: ${receipt.compilationId}\nfuzzy pairs: ${result.matches.length} · candidate concepts ${result.candidate.concepts.length} · assurance unreviewed\nEvery pair remains a conflict. Resolve exactly one member with a hash-bound review before materialization; accept-all-safe does not merge it.\n`,
  );
  return 0;
}

export async function runKnowledgeCompilationCommand(input: {
  operation: CompilationOperation;
  args: string[];
  io: CliIo;
  usage: string;
}): Promise<number> {
  try {
    if (input.operation === "compile") return await compile(input.args, input.io, input.usage);
    if (input.operation === "compare") return await compare(input.args, input.io);
    if (input.operation === "stability") return await stability(input.args, input.io);
    if (input.operation === "merge-candidate") return await mergeCandidate(input.args, input.io);
    return await fuzzyMergeCandidate(input.args, input.io);
  } catch (error) {
    input.io.stderr(`${error instanceof Error ? error.message : String(error)}\n${input.usage}\n`);
    return 1;
  }
}
