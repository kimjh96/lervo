import { requireCompleteRepositoryKnowledgeCoverage } from "./scan-completeness.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import type { RepositoryKnowledgeScan, RepositorySourceUnit } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

export interface SemanticCompilerDescriptor {
  compilerId: string;
  compilerVersion: string;
  compilerBuildId: string;
  provider: "codex" | "claude" | "cross_provider";
  isolation: "external_no_capabilities" | "deterministic_local_derivation";
}

export interface SemanticCompilerSourceUnit {
  unitVersionId: string;
  unitKind: RepositorySourceUnit["unitKind"];
  path: string;
  locator: string;
  contentHash: string;
  untrustedSourceData: string;
}

export interface SemanticCompilerEnvelope {
  schemaVersion: 1;
  shardId: string;
  sourceSnapshotId: string;
  outputLanguage: string;
  control: {
    sourceIsUntrustedData: true;
    filesystemRead: "deny";
    filesystemWrite: "deny";
    shellProcess: "deny";
    network: "deny";
    externalAction: "deny";
    toolCalls: "deny";
  };
  sourceUnits: SemanticCompilerSourceUnit[];
}

export interface SemanticCompilerResponse {
  schemaVersion: 1;
  concepts: Array<{
    localKey: string;
    title: string;
    type:
      | "concept"
      | "decision"
      | "invariant"
      | "procedure"
      | "responsibility"
      | "dependency"
      | "open_question";
    summary: string;
    claims: Array<{
      localKey: string;
      statement: string;
      evidenceUnitVersionIds: string[];
    }>;
  }>;
  relations: Array<{
    fromConceptKey: string;
    toConceptKey: string;
    type: "depends_on" | "constrains" | "related_to" | "supersedes" | "contradicts";
    evidenceUnitVersionIds: string[];
  }>;
  telemetry: {
    filesystemReads: number;
    filesystemWrites: number;
    shellProcesses: number;
    networkRequests: number;
    externalActions: number;
    toolCalls: number;
    complete: true;
  };
}

export interface RepositorySemanticCompiler {
  readonly descriptor: SemanticCompilerDescriptor & {
    provider: "codex" | "claude";
    isolation: "external_no_capabilities";
  };
  compile(envelope: SemanticCompilerEnvelope, signal: AbortSignal): Promise<unknown>;
}

export interface CrossProviderExactMergeDerivation {
  kind: "cross_provider_exact_merge";
  comparisonId: string;
  sourceCandidates: {
    codex: { compilationId: string; artifactHash: string };
    claude: { compilationId: string; artifactHash: string };
  };
  selectedConceptSignatures: string[];
  selectedClaimSignatures: string[];
  selectedRelationSignatures: string[];
}

export interface CrossProviderFuzzyConceptPair {
  matchId: string;
  scoreBasisPoints: number;
  codexSourceConceptId: string;
  claudeSourceConceptId: string;
  candidateConceptIds: [string, string];
}

export interface CrossProviderFuzzyMergeDerivation {
  kind: "cross_provider_approval_gated_fuzzy_merge";
  comparisonId: string;
  sourceCandidates: CrossProviderExactMergeDerivation["sourceCandidates"];
  similarity: {
    algorithm: "unicode_token_dice_v1";
    thresholdBasisPoints: 6000;
    ambiguityMarginBasisPoints: 1000;
    minimumSharedTokens: 2;
  };
  fuzzyConceptPairs: CrossProviderFuzzyConceptPair[];
}

export interface KnowledgeCompilationCandidate {
  schemaVersion: 1;
  compilationId: string;
  sourceSnapshotId: string;
  source: {
    scannerBuild: RepositoryKnowledgeScan["scannerBuild"];
    policyId: string;
    policyHash: string;
    partitionerBuild: "semantic-shards-v1";
  };
  compiler: SemanticCompilerDescriptor;
  derivation?: CrossProviderExactMergeDerivation | CrossProviderFuzzyMergeDerivation;
  shardIds: string[];
  inventoryCoverage: RepositoryKnowledgeScan["inventoryCoverage"];
  coverage: {
    shardCount: number;
    compiledShardCount: number;
    unitCount: number;
    complete: true;
  };
  coverageDigest: string;
  concepts: Array<{
    conceptId: string;
    title: string;
    type: SemanticCompilerResponse["concepts"][number]["type"];
    summary: string;
    assurance: "unreviewed";
    claims: Array<{
      claimId: string;
      statement: string;
      statementDigest: string;
      evidenceUnitVersionIds: string[];
      assurance: "unreviewed";
    }>;
  }>;
  relations: Array<{
    relationId: string;
    fromConceptId: string;
    toConceptId: string;
    type: SemanticCompilerResponse["relations"][number]["type"];
    evidenceUnitVersionIds: string[];
    assurance: "unreviewed";
  }>;
}

function compilationMaterials(
  candidate: Omit<KnowledgeCompilationCandidate, "schemaVersion" | "compilationId">,
): unknown {
  return {
    sourceSnapshotId: candidate.sourceSnapshotId,
    source: candidate.source,
    compiler: candidate.compiler,
    ...(candidate.derivation === undefined ? {} : { derivation: candidate.derivation }),
    shardIds: candidate.shardIds,
    inventoryCoverage: candidate.inventoryCoverage,
    coverage: candidate.coverage,
    coverageDigest: candidate.coverageDigest,
    concepts: candidate.concepts,
    relations: candidate.relations,
  };
}

export function calculateKnowledgeCompilationId(
  candidate: Omit<KnowledgeCompilationCandidate, "schemaVersion" | "compilationId">,
): string {
  return stableId("kcomp", canonicalJson(compilationMaterials(candidate)));
}

const MAX_SHARD_UNITS = 128;
const MAX_SHARD_BYTES = 256 * 1024;
const MAX_RESPONSE_CONCEPTS = 64;
const MAX_RESPONSE_RELATIONS = 256;
const KEY = /^[a-z][a-z0-9_-]{0,63}$/;

function sourceUnitData(scan: RepositoryKnowledgeScan): SemanticCompilerSourceUnit[] {
  const sources = new Map(
    scan.sources
      .filter(
        (source) =>
          source.status === "included" &&
          source.classification === "ordinary" &&
          (source.agentArtifact === undefined ||
            source.agentArtifact.contentHandling === "semantic_source") &&
          source.content !== undefined &&
          source.contentHash !== null,
      )
      .map((source) => [source.sourceId, source]),
  );
  const bySource = new Map<string, RepositorySourceUnit[]>();
  for (const unit of scan.units) {
    const values = bySource.get(unit.sourceId) ?? [];
    values.push(unit);
    bySource.set(unit.sourceId, values);
  }
  const selected = [...bySource.values()].flatMap((units) => {
    const specific = units.filter((unit) => unit.unitKind !== "file");
    return specific.length > 0 ? specific : units.filter((unit) => unit.unitKind === "file");
  });
  return selected.flatMap((unit) => {
    const source = sources.get(unit.sourceId);
    if (source?.content === undefined) return [];
    const bytes = Buffer.from(source.content);
    const snippet = bytes.subarray(unit.range.startByte, unit.range.endByte).toString("utf8");
    return [
      {
        unitVersionId: unit.unitVersionId,
        unitKind: unit.unitKind,
        path: unit.path,
        locator: unit.locator,
        contentHash: unit.unitHash,
        untrustedSourceData: snippet,
      },
    ];
  });
}

function shardUnits(
  scan: RepositoryKnowledgeScan,
  outputLanguage: string,
): SemanticCompilerEnvelope[] {
  const units = sourceUnitData(scan);
  const shards: SemanticCompilerSourceUnit[][] = [];
  let current: SemanticCompilerSourceUnit[] = [];
  let bytes = 0;
  for (const unit of units) {
    const unitBytes = Buffer.byteLength(unit.untrustedSourceData);
    if (unitBytes > MAX_SHARD_BYTES) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_limit_exceeded",
        "A semantic compiler source unit exceeds the shard byte limit.",
      );
    }
    if (
      current.length > 0 &&
      (current.length >= MAX_SHARD_UNITS || bytes + unitBytes > MAX_SHARD_BYTES)
    ) {
      shards.push(current);
      current = [];
      bytes = 0;
    }
    current.push(unit);
    bytes += unitBytes;
  }
  if (current.length > 0) shards.push(current);
  return shards.map((sourceUnits) => {
    const shardId = stableId("kshard", {
      snapshotId: scan.snapshotId,
      outputLanguage,
      unitVersions: sourceUnits.map((unit) => unit.unitVersionId),
      partitioner: "semantic-shards-v1",
    });
    return {
      schemaVersion: 1,
      shardId,
      sourceSnapshotId: scan.snapshotId,
      outputLanguage,
      control: {
        sourceIsUntrustedData: true,
        filesystemRead: "deny",
        filesystemWrite: "deny",
        shellProcess: "deny",
        network: "deny",
        externalAction: "deny",
        toolCalls: "deny",
      },
      sourceUnits,
    };
  });
}

function requiredResponse(
  value: unknown,
  envelope: SemanticCompilerEnvelope,
): SemanticCompilerResponse {
  const response = value as Partial<SemanticCompilerResponse> | null;
  const allowedEvidence = new Set(envelope.sourceUnits.map((unit) => unit.unitVersionId));
  const telemetry = response?.telemetry;
  if (
    response === null ||
    typeof response !== "object" ||
    response.schemaVersion !== 1 ||
    !Array.isArray(response.concepts) ||
    response.concepts.length > MAX_RESPONSE_CONCEPTS ||
    !Array.isArray(response.relations) ||
    response.relations.length > MAX_RESPONSE_RELATIONS ||
    telemetry === undefined ||
    telemetry.complete !== true ||
    [
      telemetry.filesystemReads,
      telemetry.filesystemWrites,
      telemetry.shellProcesses,
      telemetry.networkRequests,
      telemetry.externalActions,
      telemetry.toolCalls,
    ].some((count) => count !== 0)
  )
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "The semantic compiler did not prove the no-capability contract.",
    );
  const conceptKeys = new Set<string>();
  for (const concept of response.concepts) {
    if (
      concept === null ||
      typeof concept !== "object" ||
      !KEY.test(concept.localKey) ||
      conceptKeys.has(concept.localKey) ||
      typeof concept.title !== "string" ||
      concept.title.length < 1 ||
      concept.title.length > 160 ||
      typeof concept.summary !== "string" ||
      concept.summary.length < 1 ||
      concept.summary.length > 2_000 ||
      ![
        "concept",
        "decision",
        "invariant",
        "procedure",
        "responsibility",
        "dependency",
        "open_question",
      ].includes(concept.type) ||
      !Array.isArray(concept.claims) ||
      concept.claims.length > 64
    )
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        "A semantic compiler concept does not satisfy the contract.",
      );
    conceptKeys.add(concept.localKey);
    const claimKeys = new Set<string>();
    for (const claim of concept.claims) {
      if (
        claim === null ||
        typeof claim !== "object" ||
        !KEY.test(claim.localKey) ||
        claimKeys.has(claim.localKey) ||
        typeof claim.statement !== "string" ||
        claim.statement.length < 1 ||
        claim.statement.length > 2_000 ||
        !Array.isArray(claim.evidenceUnitVersionIds) ||
        claim.evidenceUnitVersionIds.length < 1 ||
        claim.evidenceUnitVersionIds.some(
          (id) => typeof id !== "string" || !allowedEvidence.has(id),
        ) ||
        new Set(claim.evidenceUnitVersionIds).size !== claim.evidenceUnitVersionIds.length
      )
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          "Semantic compiler claim provenance does not satisfy the contract.",
        );
      claimKeys.add(claim.localKey);
    }
  }
  for (const relation of response.relations) {
    if (
      relation === null ||
      typeof relation !== "object" ||
      !conceptKeys.has(relation.fromConceptKey) ||
      !conceptKeys.has(relation.toConceptKey) ||
      !["depends_on", "constrains", "related_to", "supersedes", "contradicts"].includes(
        relation.type,
      ) ||
      !Array.isArray(relation.evidenceUnitVersionIds) ||
      relation.evidenceUnitVersionIds.length < 1 ||
      relation.evidenceUnitVersionIds.some(
        (id) => typeof id !== "string" || !allowedEvidence.has(id),
      ) ||
      new Set(relation.evidenceUnitVersionIds).size !== relation.evidenceUnitVersionIds.length
    )
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        "Semantic compiler relation provenance does not satisfy the contract.",
      );
  }
  const normalized = structuredClone(response as SemanticCompilerResponse);
  for (const concept of normalized.concepts) {
    concept.claims.sort((left, right) => left.localKey.localeCompare(right.localKey));
    for (const claim of concept.claims) claim.evidenceUnitVersionIds.sort();
  }
  normalized.concepts.sort((left, right) => left.localKey.localeCompare(right.localKey));
  for (const relation of normalized.relations) relation.evidenceUnitVersionIds.sort();
  normalized.relations.sort(
    (left, right) =>
      left.fromConceptKey.localeCompare(right.fromConceptKey) ||
      left.toConceptKey.localeCompare(right.toConceptKey) ||
      left.type.localeCompare(right.type) ||
      left.evidenceUnitVersionIds
        .join("\u0000")
        .localeCompare(right.evidenceUnitVersionIds.join("\u0000")),
  );
  return normalized;
}

export async function compileRepositoryKnowledgeCandidate(input: {
  scan: RepositoryKnowledgeScan;
  policyHash: string;
  compiler: RepositorySemanticCompiler;
  signal: AbortSignal;
  outputLanguage?: string;
}): Promise<KnowledgeCompilationCandidate> {
  requireCompleteRepositoryKnowledgeCoverage(input.scan);
  if (!/^sha256:[a-f0-9]{64}$/.test(input.policyHash)) {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "The semantic compilation policy hash is invalid.",
    );
  }
  if (
    (input.compiler.descriptor.provider !== "codex" &&
      input.compiler.descriptor.provider !== "claude") ||
    input.compiler.descriptor.isolation !== "external_no_capabilities" ||
    !/^[a-z][a-z0-9._-]{2,63}$/.test(input.compiler.descriptor.compilerId) ||
    input.compiler.descriptor.compilerVersion.length === 0 ||
    !/^sha256:[a-f0-9]{64}$/.test(input.compiler.descriptor.compilerBuildId)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "The semantic compiler isolation contract is invalid.",
    );
  }
  const outputLanguage = input.outputLanguage ?? "en";
  if (outputLanguage !== "en") {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      `Unsupported semantic publication language: ${outputLanguage}`,
    );
  }
  const envelopes = shardUnits(input.scan, outputLanguage);
  const compiled: Array<{
    envelope: SemanticCompilerEnvelope;
    response: SemanticCompilerResponse;
  }> = [];
  for (const envelope of envelopes) {
    if (input.signal.aborted)
      throw input.signal.reason ?? new Error("semantic compilation cancelled");
    const response = requiredResponse(
      await input.compiler.compile(structuredClone(envelope), input.signal),
      envelope,
    );
    compiled.push({ envelope, response });
  }
  const concepts = compiled.flatMap(({ envelope, response }) =>
    response.concepts.map((concept) => {
      const conceptId = stableId("concept_candidate", {
        compilationSource: input.scan.snapshotId,
        shardId: envelope.shardId,
        localKey: concept.localKey,
        compiler: input.compiler.descriptor,
      });
      return {
        conceptId,
        title: concept.title,
        type: concept.type,
        summary: concept.summary,
        assurance: "unreviewed" as const,
        claims: concept.claims.map((claim) => ({
          claimId: stableId("claim_candidate", { conceptId, localKey: claim.localKey }),
          statement: claim.statement,
          statementDigest: sha256(claim.statement),
          evidenceUnitVersionIds: [...claim.evidenceUnitVersionIds].sort(),
          assurance: "unreviewed" as const,
        })),
      };
    }),
  );
  const conceptByShardKey = new Map<string, string>();
  let conceptCursor = 0;
  for (const item of compiled) {
    for (const concept of item.response.concepts) {
      conceptByShardKey.set(
        `${item.envelope.shardId}:${concept.localKey}`,
        concepts[conceptCursor]?.conceptId ?? "",
      );
      conceptCursor += 1;
    }
  }
  const relations = compiled.flatMap(({ envelope, response }) =>
    response.relations.map((relation) => {
      const fromConceptId =
        conceptByShardKey.get(`${envelope.shardId}:${relation.fromConceptKey}`) ?? "";
      const toConceptId =
        conceptByShardKey.get(`${envelope.shardId}:${relation.toConceptKey}`) ?? "";
      return {
        relationId: stableId("relation_candidate", {
          fromConceptId,
          toConceptId,
          type: relation.type,
          evidence: [...relation.evidenceUnitVersionIds].sort(),
        }),
        fromConceptId,
        toConceptId,
        type: relation.type,
        evidenceUnitVersionIds: [...relation.evidenceUnitVersionIds].sort(),
        assurance: "unreviewed" as const,
      };
    }),
  );
  const coverage = {
    shardCount: envelopes.length,
    compiledShardCount: compiled.length,
    unitCount: envelopes.reduce((count, envelope) => count + envelope.sourceUnits.length, 0),
    complete: true as const,
  };
  const shardIds = envelopes.map((envelope) => envelope.shardId);
  const source = {
    scannerBuild: input.scan.scannerBuild,
    policyId: input.scan.policyId,
    policyHash: input.policyHash,
    partitionerBuild: "semantic-shards-v1" as const,
  };
  const coverageDigest = sha256(
    canonicalJson({ inventoryCoverage: input.scan.inventoryCoverage, coverage, shardIds }),
  );
  const content: Omit<KnowledgeCompilationCandidate, "schemaVersion" | "compilationId"> = {
    sourceSnapshotId: input.scan.snapshotId,
    source,
    compiler: input.compiler.descriptor,
    shardIds,
    inventoryCoverage: input.scan.inventoryCoverage,
    coverage,
    coverageDigest,
    concepts,
    relations,
  };
  return {
    schemaVersion: 1,
    compilationId: calculateKnowledgeCompilationId(content),
    ...structuredClone(content),
  };
}
