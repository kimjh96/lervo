import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { basename, dirname, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { parse, stringify } from "yaml";
import { loadDecisionTaxonomy, type DecisionTaxonomy } from "@lervo/project";
import { hashSkillPackageProjection } from "@lervo/skills";

import { listKnowledgeArtifactPaths, shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import { scanConfiguredRepositoryKnowledge } from "./compiler.js";
import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeDeleteOperation,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { bytePreservedDocumentCollection } from "./document-layout.js";
import { createDocumentNormalizationShardCache } from "./document-normalization-cache.js";
import {
  createDocumentNormalizationObservationTracker,
  unavailableDocumentNormalizationTokenUsage,
  type DocumentNormalizationCompilerObservation,
  type DocumentNormalizationResourceObservation,
} from "./document-normalization-observation.js";
import {
  assertDocumentNormalizationPreflightReady,
  createDocumentNormalizationPreflightReport,
  documentNormalizationWorksetBinding,
  resolveDocumentNormalizationResourceCeilings,
  selectDocumentNormalizationPaths,
  type DocumentNormalizationPreflight,
  type DocumentNormalizationResourceCeilings,
  type DocumentNormalizationScope,
  type DocumentNormalizationWorksetBinding,
} from "./document-normalization-workset.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { repositoryPathMatchesPatterns } from "./scanner.js";
import {
  RepositoryKnowledgeError,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScan,
  type RepositoryKnowledgeScanOptions,
  type RepositoryKnowledgePreparedScanOptions,
  type RepositorySource,
  type RepositorySourceUnit,
} from "./types.js";

const MAX_ENVELOPE_DOCUMENTS = 2;
const MAX_ENVELOPE_BYTES = 32 * 1024;
const MAX_CONCURRENT_SHARDS = 3;
const MAX_OUTPUT_DOCUMENTS = 12;
const MAX_OUTPUT_BYTES = 32 * 1024;
const MAX_CANDIDATE_BYTES = 16 * 1024 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const SKILL_MANIFEST_NAMES = new Set(["lervo-skill.json", "lervo-capability.json"]);
const DOCUMENT_NORMALIZATION_PROFILES = new Set<DocumentNormalizationProfile>([
  "human_readme",
  "agent_instruction",
  "provider_bridge",
  "portable_skill",
  "skill_reference",
  "decision_record",
  "product_document",
  "architecture_document",
  "specification_document",
  "roadmap_document",
  "instruction_document",
  "handoff_document",
  "pull_request_template",
  "repository_document",
]);

export type DocumentNormalizationProfile =
  | "human_readme"
  | "agent_instruction"
  | "provider_bridge"
  | "portable_skill"
  | "skill_reference"
  | "decision_record"
  | "product_document"
  | "architecture_document"
  | "specification_document"
  | "roadmap_document"
  | "instruction_document"
  | "handoff_document"
  | "pull_request_template"
  | "repository_document";

export interface DocumentNormalizationCompilerDescriptor {
  compilerId: string;
  compilerVersion: string;
  compilerBuildId: string;
  provider: "codex" | "claude";
  isolation: "external_no_capabilities";
}

export interface DocumentNormalizationEnvelopeDocument {
  path: string;
  profile: DocumentNormalizationProfile;
  contentHash: string;
  untrustedSourceData: string;
  sourceUnits: Array<{ index: number; unitVersionId: string; locator: string; title?: string }>;
  protectedFragments: Array<{
    kind:
      | "frontmatter"
      | "lifecycle_metadata"
      | "managed_block"
      | "fenced_code"
      | "inline_code"
      | "link_target"
      | "provider_import";
    value: string;
  }>;
  requiredSkillName: string | null;
  constraints: {
    outputLanguage: string;
    preserveMeaning: true;
    preserveCodeIdentifiersAndReferences: true;
    requireShortEntrypoint: boolean;
    allowSiblingTopicSplit: boolean;
    requiredEntrypointPath: string;
    allowedSplitPrefix: string | null;
    maximumOutputBytes: number;
    maximumOutputLines: number;
    headingPolicy: "require_h1" | "forbid_h1";
    requiredAgentInstructionPath?: "AGENTS.md";
    rewriteWikiLinksAsMarkdown?: true;
  };
}

export interface DocumentNormalizationEnvelope {
  schemaVersion: 1;
  shardId: string;
  sourceSnapshotId: string;
  outputLanguage: string;
  formatVersion: "lervo.document.v1";
  control: {
    sourceIsUntrustedData: true;
    filesystemRead: "deny";
    filesystemWrite: "deny";
    shellProcess: "deny";
    network: "deny";
    externalAction: "deny";
    toolCalls: "deny";
  };
  documents: DocumentNormalizationEnvelopeDocument[];
}

export interface DocumentNormalizationResponse {
  schemaVersion: 1;
  documents: Array<{
    sourcePath: string;
    outputs: Array<{
      path: string;
      content: string;
      coveredUnitIndexes: number[];
    }>;
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

export interface RepositoryDocumentNormalizationCompiler {
  readonly descriptor: DocumentNormalizationCompilerDescriptor;
  normalize(envelope: DocumentNormalizationEnvelope, signal: AbortSignal): Promise<unknown>;
  normalizeObserved?(
    envelope: DocumentNormalizationEnvelope,
    signal: AbortSignal,
  ): Promise<DocumentNormalizationCompilerObservation>;
}

export interface DocumentNormalizationCompilationResult {
  candidate: DocumentNormalizationCandidate;
  resourceObservation: DocumentNormalizationResourceObservation;
}

export interface DocumentNormalizationShardProgress {
  index: number;
  total: number;
  shardId: string;
  documentCount: number;
  cachedDocumentCount: number;
  status: "started" | "cache_hit" | "split_retry" | "completed";
}

export interface DocumentNormalizationCandidateOutput {
  path: string;
  content: string;
  contentHash: string;
  byteCount: number;
  coveredUnitVersionIds: string[];
}

export interface DocumentNormalizationCandidateItem {
  operationId: string;
  approvalHash: string;
  sourcePath: string;
  sourceContentHash: string;
  sourceByteCount: number;
  profile: DocumentNormalizationProfile;
  sourceUnitVersionIds: string[];
  resourceBindings: Array<{ path: string; contentHash: string }>;
  outputs: DocumentNormalizationCandidateOutput[];
}

export interface DocumentNormalizationCandidate {
  schemaVersion: 1;
  candidateId: string;
  sourceSnapshotId: string;
  outputLanguage: string;
  formatVersion: "lervo.document.v1";
  compiler: DocumentNormalizationCompilerDescriptor;
  workset: DocumentNormalizationWorksetBinding;
  shardIds: string[];
  items: DocumentNormalizationCandidateItem[];
  coverage: {
    eligibleDocuments: number;
    normalizedDocuments: number;
    sourceUnits: number;
    complete: true;
  };
  assurance: "unreviewed";
}

interface DocumentNormalizationRecord {
  schemaVersion: 1 | 2;
  recordId: string;
  candidateId: string;
  operationId: string;
  sourcePath: string;
  sourceContentHash: string;
  outputLanguage: string;
  formatVersion: "lervo.document.v1";
  profile: DocumentNormalizationProfile;
  compiler: DocumentNormalizationCompilerDescriptor;
  sourceUnitVersionIds: string[];
  resourceBindings: Array<{ path: string; contentHash: string }>;
  outputs: Array<{ path: string; contentHash: string; userRegionHash: string; byteCount: number }>;
  byteOwnership?: { owner: "reviewer"; rewritePolicy: "reviewed_exact" };
}

export interface DocumentNormalizationPlan {
  schemaVersion: 1;
  planKind: "document_normalization";
  planId: string;
  status: "current" | "review_required" | "blocked";
  projectId: string;
  repositoryRoot: string;
  sourceSnapshotId: string;
  candidateId: string | null;
  outputLanguage: string;
  formatVersion: "lervo.document.v1";
  workset: DocumentNormalizationWorksetBinding;
  items: DocumentNormalizationCandidateItem[];
  blockers: Array<{ code: "destination_exists" | "candidate_stale"; path: string }>;
  operations: Array<
    DurableKnowledgeUserFileOperation | DurableKnowledgeDeleteOperation | KnowledgeFileOperation
  >;
}

export interface DocumentNormalizationReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "normalize_documents";
  planId: string;
  projectId: string;
  sourceSnapshotId: string;
  candidateId: string;
  workset: DocumentNormalizationWorksetBinding;
  approvalDigest: string;
  normalizedDocumentCount: number;
  outputDocumentCount: number;
  pathDigests: string[];
  created: string[];
  updated: string[];
  deleted: string[];
  appliedAt: string;
}

function normalizationProfile(source: RepositorySource): DocumentNormalizationProfile | null {
  if (!/\.md$/iu.test(source.path)) return null;
  if (source.path === "README.md" || /\/README\.md$/u.test(source.path)) return "human_readme";
  if (source.path === "AGENTS.md" || /\/(?:AGENTS|AGENTS\.override)\.md$/u.test(source.path))
    return "agent_instruction";
  if (source.path === "CLAUDE.md" || /\/(?:CLAUDE|CLAUDE\.local)\.md$/u.test(source.path))
    return "provider_bridge";
  if (source.path === ".github/PULL_REQUEST_TEMPLATE.md") return "pull_request_template";
  if (/^(?:.*\/)?\.agents\/skills\/[^/]+\/SKILL\.md$/u.test(source.path)) return "portable_skill";
  if (/^(?:.*\/)?\.agents\/skills\/[^/]+\/references\/.*\.md$/u.test(source.path))
    return "skill_reference";
  if (/^docs\/decisions\//u.test(source.path)) return "decision_record";
  if (/^docs\/product\//u.test(source.path)) return "product_document";
  if (/^docs\/architecture\//u.test(source.path)) return "architecture_document";
  if (/^docs\/(?:specifications|specs)\//u.test(source.path)) return "specification_document";
  if (/^docs\/roadmap\//u.test(source.path)) return "roadmap_document";
  if (/^docs\/instructions\//u.test(source.path)) return "instruction_document";
  if (source.content !== undefined) {
    const headings = [...source.content.matchAll(/^#{1,6}\s+(.+)$/gmu)]
      .map((match) => match[1]!)
      .join("\n");
    const name = `${basename(source.path, ".md")} ${headings.slice(0, 500)}`;
    const named =
      /(?:handoff|hand-over|session|context|status|progress|resume|continuation|current[-_ ]?(?:work|task)|work[-_ ]?log|\uC778\uACC4|\uC138\uC158|\uB9E5\uB77D|\uC9C4\uD589|\uD604\uD669|\uC791\uC5C5)/iu.test(
        name,
      );
    const structured =
      /(?:objective|goal|purpose|focus|\uBAA9\uD45C|\uBAA9\uC801|\uC911\uC810)/iu.test(headings) &&
      /(?:next|action|resume|procedure|task|continue|todo|\uB2E4\uC74C|\uD560 \uC77C|\uC7AC\uAC1C|\uC774\uC5B4|\uC791\uC5C5)/iu.test(
        headings,
      );
    const active =
      /(?:\b(?:resume|continue|next step|in progress|remaining)\b|\uC7AC\uAC1C|\uC774\uC5B4\uC11C|\uB2E4\uC74C \uC791\uC5C5|\uC9C4\uD589 \uC911|\uB0A8\uC740 \uC791\uC5C5)/iu.test(
        source.content.slice(0, 8192),
      );
    if ((named && active) || structured) return "handoff_document";
  }
  if (
    source.kind === "documentation" ||
    source.kind === "instruction" ||
    source.kind === "skill_contract"
  )
    return "repository_document";
  return null;
}

function portableSkillRoot(path: string): string | null {
  const match = /^(.*\.agents\/skills\/[^/]+)\//u.exec(path);
  return match?.[1] ?? null;
}

function portableSkillResourceBindings(
  scan: RepositoryKnowledgeScan,
  sourcePath: string,
): Array<{ path: string; contentHash: string }> {
  const skillRoot = portableSkillRoot(sourcePath);
  if (skillRoot === null) return [];
  return scan.sources
    .filter(
      (source) =>
        source.path.startsWith(`${skillRoot}/`) &&
        source.path !== sourcePath &&
        !SKILL_MANIFEST_NAMES.has(basename(source.path)) &&
        source.status === "included" &&
        source.contentHash !== null,
    )
    .map((source) => ({ path: source.path, contentHash: source.contentHash! }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function frontmatterName(content: string): string | null {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(content);
  if (match === null) return null;
  try {
    const value = parse(match[1]!) as { name?: unknown } | null;
    return typeof value?.name === "string" ? value.name : null;
  } catch {
    return null;
  }
}

function protectedMarkdownFragments(
  content: string,
  profile: DocumentNormalizationProfile,
): DocumentNormalizationEnvelopeDocument["protectedFragments"] {
  const criticalInstruction = [
    "portable_skill",
    "skill_reference",
    "agent_instruction",
    "instruction_document",
  ].includes(profile);
  const portableSkillMaterial = ["portable_skill", "skill_reference"].includes(profile);
  const fragments: DocumentNormalizationEnvelopeDocument["protectedFragments"] = [
    ...(["agent_instruction", "instruction_document", "skill_reference"].includes(profile)
      ? (content.match(/^---\n[\s\S]*?\n---(?:\n|$)/u) ?? []).map((value) => ({
          kind: "frontmatter" as const,
          value,
        }))
      : []),
    ...(content.match(/<!-- lervo:begin\b[^>]*-->[\s\S]*?<!-- lervo:end\b[^>]*-->/gu) ?? []).map(
      (value) => ({ kind: "managed_block" as const, value }),
    ),
    ...(content.match(/^(?:Status|As of):[^\n]*(?:\n|$)/gmu) ?? []).map((value) => ({
      kind: "lifecycle_metadata" as const,
      value,
    })),
    ...(criticalInstruction
      ? (content.match(/```[^\n]*\n[\s\S]*?```/gu) ?? []).map((value) => ({
          kind: "fenced_code" as const,
          value,
        }))
      : []),
    ...(portableSkillMaterial
      ? (content.match(/(?<!`)`[^`\n]+`(?!`)/gu) ?? []).map((value) => ({
          kind: "inline_code" as const,
          value: value.slice(1, -1),
        }))
      : []),
    ...[...content.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)].map((match) => ({
      kind: "link_target" as const,
      value: match[1]!,
    })),
    ...(content.match(/@(?:AGENTS|CLAUDE)\.md\b/gu) ?? []).map((value) => ({
      kind: "provider_import" as const,
      value,
    })),
  ];
  return [
    ...new Map(
      fragments
        .filter((fragment) => fragment.value.length > 0)
        .map((fragment) => [`${fragment.kind}\u0000${fragment.value}`, fragment]),
    ).values(),
  ];
}

function markdownLinkTargetIdentities(path: string, content: string): Set<string> {
  return new Set(
    [...content.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)].map((match) =>
      resolvedMarkdownLinkTargetIdentity(path, match[1]!),
    ),
  );
}

function resolvedMarkdownLinkTargetIdentity(path: string, target: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(target)) return `literal:${target}`;
  const suffixIndex = [target.indexOf("?"), target.indexOf("#")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const targetPath = suffixIndex === undefined ? target : target.slice(0, suffixIndex);
  const suffix = suffixIndex === undefined ? "" : target.slice(suffixIndex);
  const resolvedPath =
    targetPath.length === 0 ? path : posix.normalize(posix.join(dirname(path), targetPath));
  return `repository:${resolvedPath}${suffix}`;
}

function outputMarkdownLinkTargetIdentities(
  outputs: readonly { path: string; content: string }[],
): Set<string> {
  return new Set(
    outputs.flatMap((output) => [...markdownLinkTargetIdentities(output.path, output.content)]),
  );
}

function maximumOutputBytes(profile: DocumentNormalizationProfile): number {
  if (profile === "handoff_document") return 12 * 1024;
  if (profile === "provider_bridge") return 2 * 1024;
  if (profile === "human_readme") return 4 * 1024;
  if (profile === "agent_instruction") return 12 * 1024;
  if (["portable_skill", "skill_reference", "instruction_document"].includes(profile))
    return 16 * 1024;
  return MAX_OUTPUT_BYTES;
}

function maximumOutputLines(profile: DocumentNormalizationProfile): number {
  if (profile === "handoff_document") return 120;
  if (profile === "provider_bridge") return 40;
  if (["human_readme", "agent_instruction"].includes(profile)) return 160;
  if (["portable_skill", "skill_reference", "instruction_document"].includes(profile)) return 240;
  return 320;
}

function headingPolicy(
  profile: DocumentNormalizationProfile,
): DocumentNormalizationEnvelopeDocument["constraints"]["headingPolicy"] {
  return profile === "pull_request_template" ? "forbid_h1" : "require_h1";
}

function hasValidHeadingStructure(
  content: string,
  policy: DocumentNormalizationEnvelopeDocument["constraints"]["headingPolicy"],
): boolean {
  const hasH1 = /^#\s+\S/mu.test(content);
  return policy === "require_h1" ? hasH1 : !hasH1 && /^##\s+\S/mu.test(content);
}

function splitPrefix(path: string, profile: DocumentNormalizationProfile): string | null {
  // The root README is a stable human entrypoint. Its durable detail belongs in
  // the repository's semantic documentation hierarchy, which cannot be chosen
  // safely by a document-local normalizer.
  if (path === "README.md") return null;
  if (
    [
      "agent_instruction",
      "provider_bridge",
      "portable_skill",
      "skill_reference",
      "decision_record",
      "pull_request_template",
    ].includes(profile)
  )
    return null;
  return `${dirname(path) === "." ? "" : `${dirname(path)}/`}${basename(path, ".md")}/`;
}

function unitsForSource(
  scan: RepositoryKnowledgeScan,
  source: RepositorySource,
): RepositorySourceUnit[] {
  const units = scan.units.filter((unit) => unit.sourceId === source.sourceId);
  const specific = units.filter((unit) => unit.unitKind !== "file");
  return (specific.length > 0 ? specific : units).sort(
    (left, right) => left.range.startByte - right.range.startByte,
  );
}

function eligibleDocuments(
  scan: RepositoryKnowledgeScan,
  publicationRoot: string,
  taxonomy?: DecisionTaxonomy,
  normalizationExclude: readonly string[] = [],
): Array<{
  source: RepositorySource & { content: string; contentHash: string };
  profile: DocumentNormalizationProfile;
  units: RepositorySourceUnit[];
}> {
  const generatedPrefix = `${publicationRoot.replace(/\/$/u, "")}/`;
  return scan.sources
    .flatMap((source) => {
      if (
        source.status !== "included" ||
        source.classification !== "ordinary" ||
        source.content === undefined ||
        source.contentHash === null ||
        source.path === "README.md" ||
        source.path === publicationRoot ||
        source.path.startsWith(generatedPrefix) ||
        (taxonomy !== undefined && bytePreservedDocumentCollection(source.path, taxonomy)) ||
        repositoryPathMatchesPatterns(source.path, normalizationExclude)
      )
        return [];
      const profile = normalizationProfile(source);
      if (profile === null) return [];
      const units = unitsForSource(scan, source);
      if (units.length === 0) return [];
      return [
        {
          source: source as RepositorySource & { content: string; contentHash: string },
          profile,
          units,
        },
      ];
    })
    .sort((left, right) => left.source.path.localeCompare(right.source.path));
}

function normalizationEnvelopes(input: {
  scan: RepositoryKnowledgeScan;
  outputLanguage: string;
  documents: ReturnType<typeof eligibleDocuments>;
}): DocumentNormalizationEnvelope[] {
  const hasRootAgentInstructions = input.scan.sources.some(
    (source) => source.path === "AGENTS.md" && source.status === "included",
  );
  const groups: (typeof input.documents)[] = [];
  let current: typeof input.documents = [];
  let bytes = 0;
  for (const document of input.documents) {
    const documentBytes = Buffer.byteLength(document.source.content);
    if (documentBytes > 1024 * 1024)
      throw new RepositoryKnowledgeError(
        "knowledge_source_limit_exceeded",
        "A document normalization source exceeds the file limit.",
      );
    if (
      current.length > 0 &&
      (current.length >= MAX_ENVELOPE_DOCUMENTS || bytes + documentBytes > MAX_ENVELOPE_BYTES)
    ) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(document);
    bytes += documentBytes;
  }
  if (current.length > 0) groups.push(current);
  return groups.map((documents) => {
    const shardId = stableId("knormshard", {
      outputLanguage: input.outputLanguage,
      formatVersion: "lervo.document.v1",
      documents: documents.map((item) => ({
        path: item.source.path,
        hash: item.source.contentHash,
      })),
    });
    return {
      schemaVersion: 1,
      shardId,
      sourceSnapshotId: input.scan.snapshotId,
      outputLanguage: input.outputLanguage,
      formatVersion: "lervo.document.v1",
      control: {
        sourceIsUntrustedData: true,
        filesystemRead: "deny",
        filesystemWrite: "deny",
        shellProcess: "deny",
        network: "deny",
        externalAction: "deny",
        toolCalls: "deny",
      },
      documents: documents.map((item) => ({
        path: item.source.path,
        profile: item.profile,
        contentHash: item.source.contentHash,
        untrustedSourceData: item.source.content,
        sourceUnits: item.units.map((unit, index) => ({
          index,
          unitVersionId: unit.unitVersionId,
          locator: unit.locator,
          ...(unit.title === undefined ? {} : { title: unit.title }),
        })),
        protectedFragments: [
          ...protectedMarkdownFragments(item.source.content, item.profile),
          ...(item.source.path === "README.md" && hasRootAgentInstructions
            ? [{ kind: "provider_import" as const, value: "AGENTS.md" }]
            : []),
        ],
        requiredSkillName:
          item.profile === "portable_skill"
            ? (frontmatterName(item.source.content) ?? basename(dirname(item.source.path)))
            : null,
        constraints: {
          outputLanguage: input.outputLanguage,
          preserveMeaning: true,
          preserveCodeIdentifiersAndReferences: true,
          requireShortEntrypoint: ["human_readme", "agent_instruction", "provider_bridge"].includes(
            item.profile,
          ),
          allowSiblingTopicSplit: splitPrefix(item.source.path, item.profile) !== null,
          requiredEntrypointPath: item.source.path,
          allowedSplitPrefix: splitPrefix(item.source.path, item.profile),
          maximumOutputBytes: maximumOutputBytes(item.profile),
          maximumOutputLines: maximumOutputLines(item.profile),
          headingPolicy: headingPolicy(item.profile),
          ...(item.source.path === "README.md" && hasRootAgentInstructions
            ? { requiredAgentInstructionPath: "AGENTS.md" as const }
            : {}),
          ...(item.source.content.includes("[[")
            ? { rewriteWikiLinksAsMarkdown: true as const }
            : {}),
        },
      })),
    };
  });
}

function envelopeWithDocuments(
  envelope: DocumentNormalizationEnvelope,
  documents: DocumentNormalizationEnvelopeDocument[],
): DocumentNormalizationEnvelope {
  return {
    ...envelope,
    shardId: stableId("knormshard", {
      outputLanguage: envelope.outputLanguage,
      formatVersion: envelope.formatVersion,
      documents: documents.map((document) => ({ path: document.path, hash: document.contentHash })),
    }),
    documents,
  };
}

function emptyNormalizationTelemetry(): DocumentNormalizationResponse["telemetry"] {
  return {
    filesystemReads: 0,
    filesystemWrites: 0,
    shellProcesses: 0,
    networkRequests: 0,
    externalActions: 0,
    toolCalls: 0,
    complete: true,
  };
}

function requiredResponse(
  value: unknown,
  envelope: DocumentNormalizationEnvelope,
): DocumentNormalizationResponse {
  const response = value as Partial<DocumentNormalizationResponse> | null;
  const telemetry = response?.telemetry;
  if (
    response === null ||
    typeof response !== "object" ||
    response.schemaVersion !== 1 ||
    !Array.isArray(response.documents) ||
    response.documents.length !== envelope.documents.length ||
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
      "The document normalizer did not prove the no-capability contract.",
    );
  const inputs = new Map(envelope.documents.map((document) => [document.path, document]));
  const seenSources = new Set<string>();
  const seenOutputs = new Set<string>();
  for (const document of response.documents) {
    if (
      document === null ||
      typeof document !== "object" ||
      typeof document.sourcePath !== "string" ||
      seenSources.has(document.sourcePath)
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        "A document normalization response has an invalid or duplicate source path.",
      );
    }
    seenSources.add(document.sourcePath);
    const source = inputs.get(document.sourcePath);
    if (
      source === undefined ||
      !Array.isArray(document.outputs) ||
      document.outputs.length < 1 ||
      document.outputs.length > MAX_OUTPUT_DOCUMENTS
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        "A document normalization response does not match its source envelope.",
      );
    }
    const allowedUnitIndexes = new Set(source.sourceUnits.map((unit) => unit.index));
    const sourceTrailingWhitespaceLines = new Set(
      source.untrustedSourceData.split("\n").filter((line) => /[ \t]+$/u.test(line)),
    );
    const covered = new Set<number>();
    const allowedSplitPrefix = source.constraints.allowedSplitPrefix;
    for (const output of document.outputs) {
      if (
        output === null ||
        typeof output !== "object" ||
        typeof output.path !== "string" ||
        typeof output.content !== "string" ||
        !Array.isArray(output.coveredUnitIndexes)
      )
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output for ${source.path} has an invalid object shape.`,
        );
      if (seenOutputs.has(output.path))
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output path ${output.path} is duplicated.`,
        );
      if (
        posix.normalize(output.path) !== output.path ||
        output.path.startsWith("/") ||
        output.path.includes("../") ||
        !output.path.endsWith(".md")
      )
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output path ${output.path} is unsafe or is not Markdown.`,
        );
      if (
        output.path !== source.path &&
        (!source.constraints.allowSiblingTopicSplit ||
          allowedSplitPrefix === null ||
          !output.path.startsWith(allowedSplitPrefix))
      )
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output ${output.path} must remain at ${source.path} or below ${source.constraints.allowedSplitPrefix ?? "the disabled split boundary"}.`,
        );
      if (!output.content.endsWith("\n") || output.content.endsWith("\n\n"))
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output ${output.path} must end with exactly one newline.`,
        );
      const outputBytes = Buffer.byteLength(output.content);
      if (outputBytes < 1 || outputBytes > source.constraints.maximumOutputBytes)
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output ${output.path} has ${outputBytes} bytes and exceeds its 1-${source.constraints.maximumOutputBytes} byte contract.`,
        );
      const outputLines = output.content.split("\n").length;
      if (outputLines > source.constraints.maximumOutputLines)
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output ${output.path} has ${outputLines} lines and exceeds its ${source.constraints.maximumOutputLines}-line contract.`,
        );
      if (
        source.constraints.headingPolicy === "require_h1" &&
        !hasValidHeadingStructure(output.content, source.constraints.headingPolicy)
      )
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output ${output.path} has no H1.`,
        );
      if (
        source.constraints.headingPolicy === "forbid_h1" &&
        !hasValidHeadingStructure(output.content, source.constraints.headingPolicy)
      )
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output ${output.path} must contain no H1 and must start its rendered sections at H2.`,
        );
      if (
        output.content
          .split("\n")
          .some((line) => /[ \t]+$/u.test(line) && !sourceTrailingWhitespaceLines.has(line))
      ) {
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The normalized output ${output.path} introduced trailing whitespace that was not present in its source.`,
        );
      }
      if (document.outputs.length === 1) {
        output.coveredUnitIndexes = [...allowedUnitIndexes];
      } else if (
        output.coveredUnitIndexes.length < 1 ||
        output.coveredUnitIndexes.some(
          (index) => !Number.isSafeInteger(index) || !allowedUnitIndexes.has(index),
        )
      ) {
        const invalidCount = output.coveredUnitIndexes.filter(
          (index) => !Number.isSafeInteger(index) || !allowedUnitIndexes.has(index),
        ).length;
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The split normalized output ${output.path} has invalid source-section coverage (${invalidCount} unknown of ${output.coveredUnitIndexes.length}).`,
        );
      }
      seenOutputs.add(output.path);
      for (const index of output.coveredUnitIndexes) covered.add(index);
    }
    const combinedOutput = document.outputs.map((output) => output.content).join("\n");
    const proseOutput = combinedOutput
      .replace(/```[^\n]*\n[\s\S]*?```/gu, "")
      .replace(/~~~[^\n]*\n[\s\S]*?~~~/gu, "");
    if (
      source.constraints.requiredAgentInstructionPath !== undefined &&
      !combinedOutput.includes(source.constraints.requiredAgentInstructionPath)
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        `The normalized root README must route agents to ${source.constraints.requiredAgentInstructionPath}.`,
      );
    }
    if (
      source.constraints.rewriteWikiLinksAsMarkdown === true &&
      /\[\[[^\]\n]+\]\]/u.test(proseOutput)
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        `The normalized output for ${source.path} retained a non-portable wiki link.`,
      );
    }
    const outputLinkTargets = outputMarkdownLinkTargetIdentities(document.outputs);
    const missingProtected = source.protectedFragments.filter((fragment) => {
      if (fragment.kind === "lifecycle_metadata")
        return !document.outputs.some((output) =>
          output.content.split("\n").includes(fragment.value.replace(/\n$/u, "")),
        );
      if (fragment.kind === "link_target")
        return !outputLinkTargets.has(
          resolvedMarkdownLinkTargetIdentity(source.path, fragment.value),
        );
      return !combinedOutput.includes(fragment.value);
    });
    if (missingProtected.length > 0) {
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        `The normalized output for ${source.path} dropped ${missingProtected.length} protected ${[...new Set(missingProtected.map((fragment) => fragment.kind))].join(", ")} fragment(s); digest ${sha256(canonicalJson(missingProtected.map((fragment) => ({ kind: fragment.kind, valueHash: sha256(fragment.value) }))))}.`,
      );
    }
    if (
      !document.outputs.some((output) => output.path === source.path) ||
      [...allowedUnitIndexes].some((index) => !covered.has(index))
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        "A normalized document must retain its entrypoint and map every source section to an output.",
      );
    }
    if (source.profile === "portable_skill") {
      const originalName = source.requiredSkillName;
      const outputName = frontmatterName(
        document.outputs.find((output) => output.path === source.path)!.content,
      );
      if (originalName === null || outputName !== originalName)
        throw new RepositoryKnowledgeError(
          "knowledge_compile_failed",
          `The portable skill rewrite for ${source.path} must use package identity ${JSON.stringify(originalName)}; observed ${JSON.stringify(outputName)}.`,
        );
    }
  }
  return response as DocumentNormalizationResponse;
}

function candidateMaterials(
  candidate: Omit<DocumentNormalizationCandidate, "schemaVersion" | "candidateId">,
): unknown {
  return candidate;
}

function safeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1_024 &&
    posix.normalize(path) === path &&
    !path.startsWith("/") &&
    !path.includes("../") &&
    !path.includes("\\") &&
    !path.includes("\u0000")
  );
}

function invalidCandidate(message: string): never {
  throw new RepositoryKnowledgeError(
    "knowledge_compile_failed",
    `The document normalization candidate is invalid: ${message}`,
  );
}

function validateDocumentNormalizationCandidate(candidate: DocumentNormalizationCandidate): void {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    candidate.schemaVersion !== 1 ||
    !/^knorm_[a-f0-9]{24}$/u.test(candidate.candidateId) ||
    !/^ksnap_[a-f0-9]{24}$/u.test(candidate.sourceSnapshotId) ||
    candidate.outputLanguage !== "en" ||
    candidate.formatVersion !== "lervo.document.v1" ||
    candidate.assurance !== "unreviewed" ||
    candidate.compiler === null ||
    typeof candidate.compiler !== "object" ||
    typeof candidate.compiler.compilerId !== "string" ||
    candidate.compiler.compilerId.length < 1 ||
    candidate.compiler.compilerId.length > 256 ||
    typeof candidate.compiler.compilerVersion !== "string" ||
    candidate.compiler.compilerVersion.length < 1 ||
    candidate.compiler.compilerVersion.length > 128 ||
    !HASH.test(candidate.compiler.compilerBuildId) ||
    !["codex", "claude"].includes(candidate.compiler.provider) ||
    candidate.compiler.isolation !== "external_no_capabilities" ||
    candidate.workset === null ||
    typeof candidate.workset !== "object" ||
    !/^knormset_[a-f0-9]{24}$/u.test(candidate.workset.worksetId) ||
    !["all_pending", "stale"].includes(candidate.workset.scope) ||
    (candidate.workset.selection !== undefined &&
      (candidate.workset.selection === null ||
        typeof candidate.workset.selection !== "object" ||
        candidate.workset.selection.kind !== "explicit_paths" ||
        Object.keys(candidate.workset.selection).length !== 1)) ||
    candidate.workset.complete !== true ||
    candidate.workset.repository === null ||
    typeof candidate.workset.repository !== "object" ||
    !Array.isArray(candidate.shardIds) ||
    !Array.isArray(candidate.items) ||
    candidate.coverage === null ||
    typeof candidate.coverage !== "object" ||
    candidate.coverage.complete !== true
  )
    invalidCandidate("the top-level contract is malformed");

  if (
    candidate.shardIds.some(
      (id) => typeof id !== "string" || !/^knormshard_[a-f0-9]{24}$/u.test(id),
    ) ||
    new Set(candidate.shardIds).size !== candidate.shardIds.length
  ) {
    invalidCandidate("shard identities are malformed or duplicated");
  }

  const sourcePaths = new Set<string>();
  const operationIds = new Set<string>();
  const outputPaths = new Set<string>();
  let sourceUnitCount = 0;
  for (const item of candidate.items) {
    if (
      item === null ||
      typeof item !== "object" ||
      !/^knormop_[a-f0-9]{24}$/u.test(item.operationId) ||
      !HASH.test(item.approvalHash) ||
      !safeRelativePath(item.sourcePath) ||
      !item.sourcePath.endsWith(".md") ||
      !HASH.test(item.sourceContentHash) ||
      !Number.isSafeInteger(item.sourceByteCount) ||
      item.sourceByteCount < 1 ||
      !DOCUMENT_NORMALIZATION_PROFILES.has(item.profile) ||
      !Array.isArray(item.sourceUnitVersionIds) ||
      item.sourceUnitVersionIds.length < 1 ||
      item.sourceUnitVersionIds.some(
        (id) => typeof id !== "string" || !/^uv_[a-f0-9]{24}$/u.test(id),
      ) ||
      new Set(item.sourceUnitVersionIds).size !== item.sourceUnitVersionIds.length ||
      !Array.isArray(item.resourceBindings) ||
      !Array.isArray(item.outputs) ||
      item.outputs.length < 1 ||
      item.outputs.length > MAX_OUTPUT_DOCUMENTS
    )
      invalidCandidate("a source operation is malformed");
    if (sourcePaths.has(item.sourcePath) || operationIds.has(item.operationId))
      invalidCandidate("source or operation identities are duplicated");
    sourcePaths.add(item.sourcePath);
    operationIds.add(item.operationId);
    sourceUnitCount += item.sourceUnitVersionIds.length;

    const resourcePaths = new Set<string>();
    for (const resource of item.resourceBindings) {
      if (
        resource === null ||
        typeof resource !== "object" ||
        !safeRelativePath(resource.path) ||
        !HASH.test(resource.contentHash) ||
        resourcePaths.has(resource.path)
      )
        invalidCandidate("a skill resource binding is malformed or duplicated");
      resourcePaths.add(resource.path);
    }

    const covered = new Set<string>();
    const allowedUnits = new Set(item.sourceUnitVersionIds);
    const allowedSplitPrefix = splitPrefix(item.sourcePath, item.profile);
    let retainsEntrypoint = false;
    for (const output of item.outputs) {
      if (
        output === null ||
        typeof output !== "object" ||
        !safeRelativePath(output.path) ||
        !output.path.endsWith(".md") ||
        typeof output.content !== "string" ||
        !output.content.endsWith("\n") ||
        output.content.endsWith("\n\n") ||
        !HASH.test(output.contentHash) ||
        output.contentHash !== sha256(output.content) ||
        !Number.isSafeInteger(output.byteCount) ||
        output.byteCount !== Buffer.byteLength(output.content) ||
        output.byteCount < 1 ||
        output.byteCount > maximumOutputBytes(item.profile) ||
        output.content.split("\n").length > maximumOutputLines(item.profile) ||
        !hasValidHeadingStructure(output.content, headingPolicy(item.profile)) ||
        !Array.isArray(output.coveredUnitVersionIds) ||
        output.coveredUnitVersionIds.length < 1 ||
        output.coveredUnitVersionIds.some(
          (id) => typeof id !== "string" || !allowedUnits.has(id),
        ) ||
        new Set(output.coveredUnitVersionIds).size !== output.coveredUnitVersionIds.length
      )
        invalidCandidate("a normalized output is malformed or violates its profile bounds");
      if (outputPaths.has(output.path)) invalidCandidate("an output destination is duplicated");
      if (
        output.path !== item.sourcePath &&
        (allowedSplitPrefix === null || !output.path.startsWith(allowedSplitPrefix))
      )
        invalidCandidate("an output escapes its document split boundary");
      outputPaths.add(output.path);
      retainsEntrypoint ||= output.path === item.sourcePath;
      for (const unitVersionId of output.coveredUnitVersionIds) covered.add(unitVersionId);
    }
    if (!retainsEntrypoint || item.sourceUnitVersionIds.some((id) => !covered.has(id)))
      invalidCandidate("a source entrypoint or source-section coverage is missing");

    const operationId = stableId("knormop", {
      sourceSnapshotId: candidate.sourceSnapshotId,
      sourcePath: item.sourcePath,
      sourceContentHash: item.sourceContentHash,
      profile: item.profile,
      outputLanguage: candidate.outputLanguage,
      formatVersion: candidate.formatVersion,
      resourceBindings: item.resourceBindings,
      outputs: item.outputs.map(({ content: _content, ...output }) => output),
    });
    const approvalHash = sha256(
      canonicalJson({
        operationId,
        action: "rewrite_user_document",
        source: {
          path: item.sourcePath,
          contentHash: item.sourceContentHash,
          byteCount: item.sourceByteCount,
        },
        outputs: item.outputs.map(({ content: _content, ...output }) => output),
        sourceUnitVersionIds: item.sourceUnitVersionIds,
        resourceBindings: item.resourceBindings,
      }),
    );
    if (item.operationId !== operationId || item.approvalHash !== approvalHash)
      invalidCandidate("an operation or approval binding does not match its content");
  }
  if (
    !Number.isSafeInteger(candidate.coverage.eligibleDocuments) ||
    candidate.coverage.eligibleDocuments !== candidate.items.length ||
    !Number.isSafeInteger(candidate.coverage.normalizedDocuments) ||
    candidate.coverage.normalizedDocuments !== candidate.items.length ||
    !Number.isSafeInteger(candidate.coverage.sourceUnits) ||
    candidate.coverage.sourceUnits !== sourceUnitCount
  )
    invalidCandidate("coverage does not match the candidate operations");
  const repositoryCounts = candidate.workset.repository;
  if (
    [
      repositoryCounts.eligibleDocuments,
      repositoryCounts.currentDocuments,
      repositoryCounts.pendingDocuments,
      repositoryCounts.staleDocuments,
      repositoryCounts.unrecordedDocuments,
      candidate.workset.selectedDocuments,
      candidate.workset.sourceBytes,
    ].some((count) => !Number.isSafeInteger(count) || count < 0) ||
    repositoryCounts.currentDocuments + repositoryCounts.pendingDocuments !==
      repositoryCounts.eligibleDocuments ||
    repositoryCounts.staleDocuments + repositoryCounts.unrecordedDocuments !==
      repositoryCounts.pendingDocuments ||
    candidate.workset.selectedDocuments !== candidate.items.length ||
    candidate.workset.sourceBytes !==
      candidate.items.reduce((sum, item) => sum + item.sourceByteCount, 0)
  )
    invalidCandidate("the workset counts do not match the repository or candidate operations");
  const expectedWorkset = documentNormalizationWorksetBinding({
    scope: candidate.workset.scope,
    sourceSnapshotId: candidate.sourceSnapshotId,
    ...repositoryCounts,
    ...(candidate.workset.selection === undefined
      ? {}
      : { selectionPaths: candidate.items.map((item) => item.sourcePath) }),
    documents: candidate.items.map((item) => ({
      path: item.sourcePath,
      contentHash: item.sourceContentHash,
      byteCount: item.sourceByteCount,
    })),
  });
  if (canonicalJson(expectedWorkset) !== canonicalJson(candidate.workset))
    invalidCandidate("the workset identity does not match its selected source content");
  const { schemaVersion: _schemaVersion, candidateId, ...materials } = candidate;
  if (stableId("knorm", candidateMaterials(materials)) !== candidateId)
    invalidCandidate("the content binding does not match the candidate ID");
}

function userRegionHash(content: string): string {
  return sha256(
    content.replace(
      /<!-- lervo:begin\b[^>]*-->[\s\S]*?<!-- lervo:end\b[^>]*-->/gu,
      "<!-- lervo:managed-block -->",
    ),
  );
}

async function validateDocumentNormalizationCandidateAgainstScan(input: {
  root: string;
  candidate: DocumentNormalizationCandidate;
  scan: RepositoryKnowledgeScan;
  publicationRoot: string;
  taxonomy: DecisionTaxonomy;
  normalizationExclude: readonly string[];
}): Promise<void> {
  validateDocumentNormalizationCandidate(input.candidate);
  const eligible = eligibleDocuments(
    input.scan,
    input.publicationRoot,
    input.taxonomy,
    input.normalizationExclude,
  );
  const lifecycle = await normalizationLifecyclePaths(input.root, input.candidate.outputLanguage);
  const pending = eligible.filter((item) => !lifecycle.current.has(item.source.path));
  let selectedPaths: Set<string>;
  try {
    selectedPaths = selectDocumentNormalizationPaths({
      scope: input.candidate.workset.scope,
      pendingPaths: new Set(pending.map((item) => item.source.path)),
      stalePaths: lifecycle.staleSources,
      ...(input.candidate.workset.selection === undefined
        ? {}
        : { requestedPaths: input.candidate.items.map((item) => item.sourcePath) }),
    });
  } catch (error) {
    if (
      error instanceof RepositoryKnowledgeError &&
      error.code === "normalization_selection_invalid"
    )
      invalidCandidate("the explicit source selection is outside the current lifecycle scope");
    throw error;
  }
  const expected = pending.filter((item) => selectedPaths.has(item.source.path));
  const expectedByPath = new Map(expected.map((item) => [item.source.path, item]));
  const candidatePaths = new Set(input.candidate.items.map((item) => item.sourcePath));
  if (
    candidatePaths.size !== expected.length ||
    expected.some((item) => !candidatePaths.has(item.source.path))
  )
    invalidCandidate(
      "the claimed complete source set does not match the current normalization lifecycle",
    );
  const expectedWorkset = documentNormalizationWorksetBinding({
    scope: input.candidate.workset.scope,
    sourceSnapshotId: input.scan.snapshotId,
    eligibleDocuments: eligible.length,
    currentDocuments: eligible.length - pending.length,
    pendingDocuments: pending.length,
    staleDocuments: pending.filter((item) => lifecycle.staleSources.has(item.source.path)).length,
    ...(input.candidate.workset.selection === undefined
      ? {}
      : { selectionPaths: input.candidate.items.map((item) => item.sourcePath) }),
    documents: expected.map((item) => ({
      path: item.source.path,
      contentHash: item.source.contentHash,
      byteCount: item.source.byteCount,
    })),
  });
  if (
    input.scan.snapshotId === input.candidate.sourceSnapshotId &&
    canonicalJson(expectedWorkset) !== canonicalJson(input.candidate.workset)
  )
    invalidCandidate("the workset does not match the current normalization lifecycle");

  const hasRootAgentInstructions = input.scan.sources.some(
    (source) => source.path === "AGENTS.md" && source.status === "included",
  );
  for (const item of input.candidate.items) {
    const expectedItem = expectedByPath.get(item.sourcePath);
    if (
      expectedItem === undefined ||
      expectedItem.profile !== item.profile ||
      expectedItem.source.contentHash !== item.sourceContentHash ||
      expectedItem.source.byteCount !== item.sourceByteCount
    ) {
      invalidCandidate("a source binding does not match the current repository inventory");
    }
    const sourceUnitVersionIds = expectedItem.units.map((unit) => unit.unitVersionId).sort();
    if (canonicalJson(sourceUnitVersionIds) !== canonicalJson(item.sourceUnitVersionIds))
      invalidCandidate(
        "source-section coverage identities do not match the current repository inventory",
      );
    const resourceBindings =
      item.profile === "portable_skill"
        ? portableSkillResourceBindings(input.scan, item.sourcePath)
        : [];
    if (canonicalJson(resourceBindings) !== canonicalJson(item.resourceBindings))
      invalidCandidate("portable skill resources do not match the current repository inventory");

    const combinedOutput = item.outputs.map((output) => output.content).join("\n");
    const proseOutput = combinedOutput
      .replace(/```[^\n]*\n[\s\S]*?```/gu, "")
      .replace(/~~~[^\n]*\n[\s\S]*?~~~/gu, "");
    if (
      item.sourcePath === "README.md" &&
      hasRootAgentInstructions &&
      !combinedOutput.includes("AGENTS.md")
    )
      invalidCandidate("the root README no longer routes agents to AGENTS.md");
    if (expectedItem.source.content.includes("[[") && /\[\[[^\]\n]+\]\]/u.test(proseOutput))
      invalidCandidate("a non-portable wiki link remains in normalized prose");
    const outputLinkTargets = outputMarkdownLinkTargetIdentities(item.outputs);
    const missingProtected = protectedMarkdownFragments(
      expectedItem.source.content,
      item.profile,
    ).filter((fragment) =>
      fragment.kind === "link_target"
        ? !outputLinkTargets.has(
            resolvedMarkdownLinkTargetIdentity(item.sourcePath, fragment.value),
          )
        : !combinedOutput.includes(fragment.value),
    );
    if (missingProtected.length > 0)
      invalidCandidate(
        `protected ${[...new Set(missingProtected.map((fragment) => fragment.kind))].join(", ")} content is missing`,
      );
    if (item.profile === "portable_skill") {
      const requiredName =
        frontmatterName(expectedItem.source.content) ?? basename(dirname(item.sourcePath));
      const outputName = frontmatterName(
        item.outputs.find((output) => output.path === item.sourcePath)!.content,
      );
      if (outputName !== requiredName) invalidCandidate("the portable skill identity changed");
    }
  }
}

export interface CompileDocumentNormalizationCandidateInput {
  scan: RepositoryKnowledgeScan;
  publicationRoot: string;
  outputLanguage: string;
  taxonomy?: DecisionTaxonomy;
  normalizationExclude?: readonly string[];
  compiler: RepositoryDocumentNormalizationCompiler;
  signal: AbortSignal;
  currentPaths?: ReadonlySet<string>;
  selectedPaths?: ReadonlySet<string>;
  workset?: DocumentNormalizationWorksetBinding;
  loadShardResponse?: (envelope: DocumentNormalizationEnvelope) => Promise<unknown | null>;
  storeShardResponse?: (
    envelope: DocumentNormalizationEnvelope,
    response: DocumentNormalizationResponse,
  ) => Promise<void>;
  onShardProgress?: (progress: DocumentNormalizationShardProgress) => void;
  ceilings?: Partial<DocumentNormalizationResourceCeilings>;
}

export async function compileDocumentNormalizationCandidateObserved(
  input: CompileDocumentNormalizationCandidateInput,
): Promise<DocumentNormalizationCompilationResult> {
  if (input.outputLanguage !== "en")
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      `Unsupported document normalization language: ${input.outputLanguage}`,
    );
  const allEligible = eligibleDocuments(
    input.scan,
    input.publicationRoot,
    input.taxonomy,
    input.normalizationExclude,
  );
  const eligible = allEligible.filter((item) =>
    input.selectedPaths === undefined
      ? !input.currentPaths?.has(item.source.path)
      : input.selectedPaths.has(item.source.path),
  );
  const envelopes = normalizationEnvelopes({
    scan: input.scan,
    outputLanguage: input.outputLanguage,
    documents: eligible,
  });
  const resourceTracker = createDocumentNormalizationObservationTracker(
    resolveDocumentNormalizationResourceCeilings(input.ceilings),
  );
  const responses: Array<
    { envelope: DocumentNormalizationEnvelope; response: DocumentNormalizationResponse } | undefined
  > = new Array(envelopes.length);
  let nextEnvelopeIndex = 0;
  let firstError: unknown = null;
  const worker = async (): Promise<void> => {
    while (firstError === null) {
      const index = nextEnvelopeIndex++;
      if (index >= envelopes.length) return;
      const envelope = envelopes[index]!;
      try {
        input.onShardProgress?.({
          index: index + 1,
          total: envelopes.length,
          shardId: envelope.shardId,
          documentCount: envelope.documents.length,
          cachedDocumentCount: 0,
          status: "started",
        });
        const responseByPath = new Map<
          string,
          DocumentNormalizationResponse["documents"][number]
        >();
        const missingDocuments: DocumentNormalizationEnvelopeDocument[] = [];
        for (const document of envelope.documents) {
          const documentEnvelope = envelopeWithDocuments(envelope, [document]);
          const cached = (await input.loadShardResponse?.(documentEnvelope)) ?? null;
          if (cached === null) {
            missingDocuments.push(document);
            continue;
          }
          try {
            const validated = requiredResponse(cached, documentEnvelope);
            responseByPath.set(document.path, validated.documents[0]!);
          } catch (error) {
            if (
              !(error instanceof RepositoryKnowledgeError) ||
              (error.code !== "knowledge_compile_failed" &&
                error.code !== "knowledge_compile_policy_violation")
            )
              throw error;
            missingDocuments.push(document);
          }
        }
        const cachedDocumentCount = responseByPath.size;
        if (missingDocuments.length === 0) {
          const response = requiredResponse(
            {
              schemaVersion: 1,
              documents: envelope.documents.map((document) => responseByPath.get(document.path)!),
              telemetry: emptyNormalizationTelemetry(),
            },
            envelope,
          );
          responses[index] = { envelope, response };
          input.onShardProgress?.({
            index: index + 1,
            total: envelopes.length,
            shardId: envelope.shardId,
            documentCount: envelope.documents.length,
            cachedDocumentCount,
            status: "cache_hit",
          });
          continue;
        }

        const normalizeMissing = async (
          documents: DocumentNormalizationEnvelopeDocument[],
        ): Promise<DocumentNormalizationResponse["documents"]> => {
          const providerEnvelope = envelopeWithDocuments(envelope, documents);
          resourceTracker.startProviderCall();
          const startedAt = performance.now();
          let callFinished = false;
          try {
            const observed =
              input.compiler.normalizeObserved === undefined
                ? {
                    response: await input.compiler.normalize(providerEnvelope, input.signal),
                    tokenUsage: unavailableDocumentNormalizationTokenUsage(),
                  }
                : await input.compiler.normalizeObserved(providerEnvelope, input.signal);
            callFinished = true;
            resourceTracker.finishProviderCall({
              elapsedMilliseconds: Math.ceil(performance.now() - startedAt),
              tokenUsage: observed.tokenUsage,
            });
            const normalized = requiredResponse(observed.response, providerEnvelope);
            for (const document of normalized.documents) {
              const source = documents.find((item) => item.path === document.sourcePath);
              if (source === undefined)
                throw new RepositoryKnowledgeError(
                  "knowledge_compile_failed",
                  "A normalized document does not match the missing source set.",
                );
              const documentEnvelope = envelopeWithDocuments(envelope, [source]);
              const documentResponse = requiredResponse(
                {
                  schemaVersion: 1,
                  documents: [document],
                  telemetry: emptyNormalizationTelemetry(),
                },
                documentEnvelope,
              );
              await input.storeShardResponse?.(documentEnvelope, documentResponse);
              responseByPath.set(document.sourcePath, documentResponse.documents[0]!);
            }
            return normalized.documents;
          } catch (error) {
            if (!callFinished)
              resourceTracker.finishProviderCall({
                elapsedMilliseconds: Math.ceil(performance.now() - startedAt),
                tokenUsage: unavailableDocumentNormalizationTokenUsage(),
              });
            if (input.signal.aborted || documents.length === 1) throw error;
            input.onShardProgress?.({
              index: index + 1,
              total: envelopes.length,
              shardId: providerEnvelope.shardId,
              documentCount: documents.length,
              cachedDocumentCount,
              status: "split_retry",
            });
            const split: DocumentNormalizationResponse["documents"] = [];
            for (const document of documents) split.push(...(await normalizeMissing([document])));
            return split;
          }
        };
        await normalizeMissing(missingDocuments);
        const response = requiredResponse(
          {
            schemaVersion: 1,
            documents: envelope.documents.map((document) => responseByPath.get(document.path)!),
            telemetry: emptyNormalizationTelemetry(),
          },
          envelope,
        );
        responses[index] = { envelope, response };
        input.onShardProgress?.({
          index: index + 1,
          total: envelopes.length,
          shardId: envelope.shardId,
          documentCount: envelope.documents.length,
          cachedDocumentCount,
          status: "completed",
        });
      } catch (error) {
        if (firstError === null) firstError = error;
      }
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          resourceTracker.requiresSerialExecution ? 1 : MAX_CONCURRENT_SHARDS,
          envelopes.length,
        ),
      },
      worker,
    ),
  );
  if (firstError !== null) throw firstError;
  const completedResponses = responses.map((response) => {
    if (response === undefined)
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        "A document normalization shard completed without a response.",
      );
    return response;
  });
  const sourceByPath = new Map(eligible.map((item) => [item.source.path, item]));
  const items = completedResponses
    .flatMap(({ response }) =>
      response.documents.map((document) => {
        const source = sourceByPath.get(document.sourcePath)!;
        const sourceUnitVersionIds = source.units.map((unit) => unit.unitVersionId).sort();
        const resourceBindings =
          source.profile === "portable_skill"
            ? portableSkillResourceBindings(input.scan, source.source.path)
            : [];
        const outputs = document.outputs
          .map((output) => ({
            path: output.path,
            content: output.content.endsWith("\n") ? output.content : `${output.content}\n`,
            contentHash: sha256(
              output.content.endsWith("\n") ? output.content : `${output.content}\n`,
            ),
            byteCount: Buffer.byteLength(
              output.content.endsWith("\n") ? output.content : `${output.content}\n`,
            ),
            coveredUnitVersionIds: [
              ...new Set(
                output.coveredUnitIndexes.map((index) => source.units[index]!.unitVersionId),
              ),
            ].sort(),
          }))
          .sort((left, right) => left.path.localeCompare(right.path));
        const operationId = stableId("knormop", {
          sourceSnapshotId: input.scan.snapshotId,
          sourcePath: source.source.path,
          sourceContentHash: source.source.contentHash,
          profile: source.profile,
          outputLanguage: input.outputLanguage,
          formatVersion: "lervo.document.v1",
          resourceBindings,
          outputs: outputs.map(({ content: _content, ...output }) => output),
        });
        const approvalHash = sha256(
          canonicalJson({
            operationId,
            action: "rewrite_user_document",
            source: {
              path: source.source.path,
              contentHash: source.source.contentHash,
              byteCount: source.source.byteCount,
            },
            outputs: outputs.map(({ content: _content, ...output }) => output),
            sourceUnitVersionIds,
            resourceBindings,
          }),
        );
        return {
          operationId,
          approvalHash,
          sourcePath: source.source.path,
          sourceContentHash: source.source.contentHash,
          sourceByteCount: source.source.byteCount,
          profile: source.profile,
          sourceUnitVersionIds,
          resourceBindings,
          outputs,
        };
      }),
    )
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const materials: Omit<DocumentNormalizationCandidate, "schemaVersion" | "candidateId"> = {
    sourceSnapshotId: input.scan.snapshotId,
    outputLanguage: input.outputLanguage,
    formatVersion: "lervo.document.v1",
    compiler: input.compiler.descriptor,
    workset:
      input.workset ??
      documentNormalizationWorksetBinding({
        scope: "all_pending",
        sourceSnapshotId: input.scan.snapshotId,
        eligibleDocuments: allEligible.length,
        currentDocuments: allEligible.length - eligible.length,
        pendingDocuments: eligible.length,
        staleDocuments: 0,
        documents: eligible.map((item) => ({
          path: item.source.path,
          contentHash: item.source.contentHash,
          byteCount: item.source.byteCount,
        })),
      }),
    shardIds: envelopes.map((envelope) => envelope.shardId),
    items,
    coverage: {
      eligibleDocuments: eligible.length,
      normalizedDocuments: items.length,
      sourceUnits: eligible.reduce((sum, item) => sum + item.units.length, 0),
      complete: true,
    },
    assurance: "unreviewed",
  };
  const candidate: DocumentNormalizationCandidate = {
    schemaVersion: 1,
    candidateId: stableId("knorm", candidateMaterials(materials)),
    ...materials,
  };
  validateDocumentNormalizationCandidate(candidate);
  return { candidate, resourceObservation: resourceTracker.observation() };
}

export async function compileDocumentNormalizationCandidate(
  input: CompileDocumentNormalizationCandidateInput,
): Promise<DocumentNormalizationCandidate> {
  return (await compileDocumentNormalizationCandidateObserved(input)).candidate;
}

function normalizationRecord(input: {
  candidate: DocumentNormalizationCandidate;
  item: DocumentNormalizationCandidateItem;
}): { path: string; content: string } {
  const recordId = stableId("knormdoc", {
    candidateId: input.candidate.candidateId,
    operationId: input.item.operationId,
  });
  const record: DocumentNormalizationRecord = {
    schemaVersion: 2,
    recordId,
    candidateId: input.candidate.candidateId,
    operationId: input.item.operationId,
    sourcePath: input.item.sourcePath,
    sourceContentHash: input.item.sourceContentHash,
    outputLanguage: input.candidate.outputLanguage,
    formatVersion: input.candidate.formatVersion,
    profile: input.item.profile,
    compiler: input.candidate.compiler,
    sourceUnitVersionIds: input.item.sourceUnitVersionIds,
    resourceBindings: projectedNormalizationResourceBindings(input),
    byteOwnership: { owner: "reviewer", rewritePolicy: "reviewed_exact" },
    outputs: input.item.outputs.map((output) => ({
      path: output.path,
      contentHash: output.contentHash,
      userRegionHash: userRegionHash(output.content),
      byteCount: output.byteCount,
    })),
  };
  return {
    path: shardedKnowledgeArtifactPath(
      ".lervo/knowledge/document-normalizations",
      recordId,
      "yaml",
    ),
    content: stringify(record, { sortMapEntries: true }),
  };
}

function projectedNormalizationResourceBindings(input: {
  candidate: DocumentNormalizationCandidate;
  item: DocumentNormalizationCandidateItem;
}): Array<{ path: string; contentHash: string }> {
  if (input.item.profile !== "portable_skill") return input.item.resourceBindings;
  const skillRoot = portableSkillRoot(input.item.sourcePath);
  if (skillRoot === null) return input.item.resourceBindings;
  const projected = new Map(
    input.item.resourceBindings.map((resource) => [resource.path, resource.contentHash]),
  );
  for (const item of input.candidate.items) {
    for (const output of item.outputs) {
      if (
        output.path.startsWith(`${skillRoot}/`) &&
        output.path !== input.item.sourcePath &&
        !SKILL_MANIFEST_NAMES.has(basename(output.path))
      ) {
        projected.set(output.path, output.contentHash);
      }
    }
  }
  return [...projected]
    .map(([path, contentHash]) => ({ path, contentHash }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function rewrittenSkillManifest(content: string, contentHash: string): string {
  const parsed = JSON.parse(content) as { contentHash?: unknown };
  if (typeof parsed.contentHash !== "string" || !HASH.test(parsed.contentHash)) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "A project skill manifest does not expose the expected content hash binding.",
    );
  }
  let replacements = 0;
  const rewritten = content.replace(
    /("contentHash"\s*:\s*")sha256:[a-f0-9]{64}(")/gu,
    (_match, prefix: string, suffix: string) => {
      replacements += 1;
      return `${prefix}${contentHash}${suffix}`;
    },
  );
  if (replacements !== 1) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "A project skill manifest content hash cannot be updated deterministically.",
    );
  }
  return rewritten;
}

async function projectedSkillManifestOperations(input: {
  repositoryRoot: string;
  scan: RepositoryKnowledgeScan;
  candidate: DocumentNormalizationCandidate;
}): Promise<DurableKnowledgeUserFileOperation[]> {
  const roots = new Set(
    input.candidate.items
      .map((item) => portableSkillRoot(item.sourcePath))
      .filter((root): root is string => root !== null),
  );
  const operations: DurableKnowledgeUserFileOperation[] = [];
  for (const skillRoot of [...roots].sort()) {
    const manifestSources = input.scan.sources.filter(
      (source) =>
        source.path.startsWith(`${skillRoot}/`) &&
        SKILL_MANIFEST_NAMES.has(basename(source.path)) &&
        source.status === "included" &&
        source.content !== undefined &&
        source.contentHash !== null,
    );
    if (!manifestSources.some((source) => basename(source.path) === "lervo-skill.json")) continue;
    const overrides = new Map<string, Uint8Array>();
    for (const item of input.candidate.items) {
      for (const output of item.outputs) {
        if (output.path.startsWith(`${skillRoot}/`)) {
          overrides.set(output.path.slice(skillRoot.length + 1), Buffer.from(output.content));
        }
      }
    }
    const directory = resolve(input.repositoryRoot, skillRoot);
    const firstHash = await hashSkillPackageProjection(directory, overrides);
    const secondHash = await hashSkillPackageProjection(directory, overrides);
    if (firstHash !== secondHash) {
      throw new RepositoryKnowledgeError(
        "knowledge_reconciliation_conflict",
        "A project skill package changed while its normalized projection was prepared.",
      );
    }
    for (const source of manifestSources.sort((left, right) =>
      left.path.localeCompare(right.path),
    )) {
      const content = rewrittenSkillManifest(source.content!, firstHash);
      const desiredHash = sha256(content);
      if (desiredHash === source.contentHash) continue;
      operations.push({
        path: source.path,
        action: "update",
        ownership: "user",
        mediaType: "application/json",
        content,
        expectedCurrentHash: source.contentHash!,
        desiredHash,
      });
    }
  }
  return operations;
}

async function hashAt(path: string): Promise<string | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return sha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function userRegionHashAt(path: string): Promise<string | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return userRegionHash(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function validDocumentNormalizationRecord(
  value: unknown,
  path: string,
  outputLanguage: string,
): value is DocumentNormalizationRecord {
  if (value === null || typeof value !== "object") return false;
  const record = value as Partial<DocumentNormalizationRecord>;
  return !(
    ![1, 2].includes(record.schemaVersion ?? 0) ||
    (record.schemaVersion === 2 &&
      (record.byteOwnership?.owner !== "reviewer" ||
        record.byteOwnership.rewritePolicy !== "reviewed_exact")) ||
    typeof record.recordId !== "string" ||
    !/^knormdoc_[a-f0-9]{24}$/u.test(record.recordId) ||
    path !==
      shardedKnowledgeArtifactPath(
        ".lervo/knowledge/document-normalizations",
        record.recordId,
        "yaml",
      ) ||
    typeof record.sourcePath !== "string" ||
    !safeRelativePath(record.sourcePath) ||
    record.outputLanguage !== outputLanguage ||
    record.formatVersion !== "lervo.document.v1" ||
    !Array.isArray(record.outputs) ||
    record.outputs.length < 1 ||
    record.outputs.some(
      (output) =>
        output === null ||
        typeof output !== "object" ||
        typeof output.path !== "string" ||
        !safeRelativePath(output.path) ||
        typeof output.contentHash !== "string" ||
        !HASH.test(output.contentHash) ||
        (output.userRegionHash !== undefined &&
          (typeof output.userRegionHash !== "string" || !HASH.test(output.userRegionHash))),
    ) ||
    !Array.isArray(record.resourceBindings) ||
    record.resourceBindings.some(
      (resource) =>
        resource === null ||
        typeof resource !== "object" ||
        typeof resource.path !== "string" ||
        !safeRelativePath(resource.path) ||
        typeof resource.contentHash !== "string" ||
        !HASH.test(resource.contentHash),
    )
  );
}

async function normalizationLifecyclePaths(
  root: string,
  outputLanguage: string,
): Promise<{ current: Set<string>; staleSources: Set<string> }> {
  const paths = await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/knowledge/document-normalizations",
    extension: "yaml",
    maximumFiles: 20_000,
  });
  const current = new Set<string>();
  const staleSources = new Set<string>();
  for (const path of paths) {
    let record: unknown = null;
    try {
      record = parse(await readFile(resolve(root, path), "utf8")) as DocumentNormalizationRecord;
    } catch {
      /* Invalid records remain pending but never qualify a source as stale. */
    }
    if (!validDocumentNormalizationRecord(record, path, outputLanguage)) continue;
    const hashes = await Promise.all(
      record.outputs.map((output) => hashAt(resolve(root, output.path))),
    );
    const userHashes = await Promise.all(
      record.outputs.map((output) =>
        output.userRegionHash === undefined ? null : userRegionHashAt(resolve(root, output.path)),
      ),
    );
    const resources = await Promise.all(
      record.resourceBindings.map((resource) => hashAt(resolve(root, resource.path))),
    );
    const isCurrent =
      hashes.every(
        (hash, index) =>
          hash === record.outputs[index]!.contentHash ||
          (record.outputs[index]!.userRegionHash !== undefined &&
            userHashes[index] === record.outputs[index]!.userRegionHash),
      ) && resources.every((hash, index) => hash === record.resourceBindings[index]!.contentHash);
    if (isCurrent) for (const output of record.outputs) current.add(output.path);
    else staleSources.add(record.sourcePath);
  }
  return { current, staleSources };
}

export interface DocumentNormalizationLifecycleInspection {
  schemaVersion: 1;
  outputLanguage: string;
  formatVersion: "lervo.document.v1";
  eligibleDocuments: number;
  currentDocuments: number;
  pendingDocuments: string[];
  records: Array<{
    path: string;
    recordId: string | null;
    status: "current" | "stale" | "invalid";
    outputPaths: string[];
    /** Outputs whose current exact bytes are a reviewed rewrite of different source bytes. */
    reviewedRewritePaths: string[];
  }>;
}

export async function inspectConfiguredDocumentNormalization(input: {
  repositoryRoot: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  preparedScan?: RepositoryKnowledgePreparedScanOptions["preparedScan"];
  allowTransactionPlanId?: string;
}): Promise<DocumentNormalizationLifecycleInspection> {
  const root = resolve(input.repositoryRoot);
  const [{ policy, scan }, taxonomy] = await Promise.all([
    scanConfiguredRepositoryKnowledge(root, {
      ...(input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources }),
      ...(input.preparedScan === undefined ? {} : { preparedScan: input.preparedScan }),
      ...(input.allowTransactionPlanId === undefined
        ? {}
        : { allowTransactionPlanId: input.allowTransactionPlanId }),
    }),
    loadDecisionTaxonomy(root),
  ]);
  const records: DocumentNormalizationLifecycleInspection["records"] = [];
  const current = new Set<string>();
  const paths = await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/knowledge/document-normalizations",
    extension: "yaml",
    maximumFiles: 20_000,
  });
  for (const path of paths) {
    let record: unknown = null;
    try {
      record = parse(await readFile(resolve(root, path), "utf8")) as DocumentNormalizationRecord;
    } catch {
      /* reported below */
    }
    if (!validDocumentNormalizationRecord(record, path, policy.publication.language)) {
      records.push({
        path,
        recordId:
          record !== null &&
          typeof record === "object" &&
          "recordId" in record &&
          typeof record.recordId === "string"
            ? record.recordId
            : null,
        status: "invalid",
        outputPaths: [],
        reviewedRewritePaths: [],
      });
      continue;
    }
    const hashes = await Promise.all(
      record.outputs.map((output) => hashAt(resolve(root, output.path))),
    );
    const userHashes = await Promise.all(
      record.outputs.map((output) =>
        output.userRegionHash === undefined ? null : userRegionHashAt(resolve(root, output.path)),
      ),
    );
    const resources = await Promise.all(
      record.resourceBindings.map((resource) => hashAt(resolve(root, resource.path))),
    );
    const status =
      hashes.every(
        (hash, index) =>
          hash === record!.outputs[index]!.contentHash ||
          (record!.outputs[index]!.userRegionHash !== undefined &&
            userHashes[index] === record!.outputs[index]!.userRegionHash),
      ) && resources.every((hash, index) => hash === record!.resourceBindings[index]!.contentHash)
        ? ("current" as const)
        : ("stale" as const);
    if (status === "current") for (const output of record.outputs) current.add(output.path);
    records.push({
      path,
      recordId: record.recordId,
      status,
      outputPaths: record.outputs.map((output) => output.path),
      reviewedRewritePaths: record.outputs
        .filter(
          (output, index) =>
            hashes[index] === output.contentHash &&
            (output.path !== record!.sourcePath ||
              output.contentHash !== record!.sourceContentHash),
        )
        .map((output) => output.path),
    });
  }
  const eligible = eligibleDocuments(
    scan,
    policy.publicationRoot,
    taxonomy,
    policy.normalization?.exclude,
  );
  const pendingDocuments = eligible
    .map((item) => item.source.path)
    .filter((path) => !current.has(path));
  return {
    schemaVersion: 1,
    outputLanguage: policy.publication.language,
    formatVersion: "lervo.document.v1",
    eligibleDocuments: eligible.length,
    currentDocuments: eligible.length - pendingDocuments.length,
    pendingDocuments,
    records,
  };
}

export interface CompileConfiguredDocumentNormalizationCandidateInput {
  repositoryRoot: string;
  compiler: RepositoryDocumentNormalizationCompiler;
  signal: AbortSignal;
  scope?: DocumentNormalizationScope;
  sourcePaths?: readonly string[];
  ceilings?: Partial<DocumentNormalizationResourceCeilings>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  onShardProgress?: (progress: DocumentNormalizationShardProgress) => void;
}

export async function compileConfiguredDocumentNormalizationCandidateObserved(
  input: CompileConfiguredDocumentNormalizationCandidateInput,
): Promise<DocumentNormalizationCompilationResult> {
  const prepared = await prepareConfiguredDocumentNormalization({
    repositoryRoot: input.repositoryRoot,
    compiler: input.compiler,
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.sourcePaths === undefined ? {} : { sourcePaths: input.sourcePaths }),
    ...(input.ceilings === undefined ? {} : { ceilings: input.ceilings }),
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  assertDocumentNormalizationPreflightReady(prepared.preflight);
  return compileDocumentNormalizationCandidateObserved({
    scan: prepared.scan,
    publicationRoot: prepared.publicationRoot,
    outputLanguage: prepared.outputLanguage,
    taxonomy: prepared.taxonomy,
    normalizationExclude: prepared.normalizationExclude,
    compiler: input.compiler,
    signal: input.signal,
    ceilings: prepared.preflight.ceilings,
    selectedPaths: prepared.selectedPaths,
    workset: prepared.preflight.workset,
    loadShardResponse: prepared.cache.load,
    storeShardResponse: prepared.cache.store,
    ...(input.onShardProgress === undefined ? {} : { onShardProgress: input.onShardProgress }),
  });
}

export async function compileConfiguredDocumentNormalizationCandidate(
  input: CompileConfiguredDocumentNormalizationCandidateInput,
): Promise<DocumentNormalizationCandidate> {
  return (await compileConfiguredDocumentNormalizationCandidateObserved(input)).candidate;
}

async function prepareConfiguredDocumentNormalization(input: {
  repositoryRoot: string;
  compiler: RepositoryDocumentNormalizationCompiler;
  scope?: DocumentNormalizationScope;
  sourcePaths?: readonly string[];
  ceilings?: Partial<DocumentNormalizationResourceCeilings>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<{
  scan: RepositoryKnowledgeScan;
  publicationRoot: string;
  outputLanguage: string;
  taxonomy: DecisionTaxonomy;
  normalizationExclude: string[];
  selectedPaths: Set<string>;
  cache: ReturnType<typeof createDocumentNormalizationShardCache>;
  preflight: DocumentNormalizationPreflight;
}> {
  const root = resolve(input.repositoryRoot);
  const [{ policy, scan }, taxonomy] = await Promise.all([
    scanConfiguredRepositoryKnowledge(
      root,
      input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources },
    ),
    loadDecisionTaxonomy(root),
  ]);
  const lifecycle = await normalizationLifecyclePaths(root, policy.publication.language);
  const eligible = eligibleDocuments(
    scan,
    policy.publicationRoot,
    taxonomy,
    policy.normalization?.exclude,
  );
  const pending = eligible.filter((item) => !lifecycle.current.has(item.source.path));
  const pendingPaths = new Set(pending.map((item) => item.source.path));
  const stale = pending.filter((item) => lifecycle.staleSources.has(item.source.path));
  const selectedPaths = selectDocumentNormalizationPaths({
    scope: input.scope ?? "all_pending",
    pendingPaths,
    stalePaths: lifecycle.staleSources,
    ...(input.sourcePaths === undefined ? {} : { requestedPaths: input.sourcePaths }),
  });
  const selected = pending.filter((item) => selectedPaths.has(item.source.path));
  const envelopes = normalizationEnvelopes({
    scan,
    outputLanguage: policy.publication.language,
    documents: selected,
  });
  const cache = createDocumentNormalizationShardCache({
    repositoryRoot: root,
    compiler: input.compiler,
  });
  const binding = documentNormalizationWorksetBinding({
    scope: input.scope ?? "all_pending",
    sourceSnapshotId: scan.snapshotId,
    eligibleDocuments: eligible.length,
    currentDocuments: eligible.length - pending.length,
    pendingDocuments: pending.length,
    staleDocuments: stale.length,
    ...(input.sourcePaths === undefined ? {} : { selectionPaths: input.sourcePaths }),
    documents: selected.map((item) => ({
      path: item.source.path,
      contentHash: item.source.contentHash,
      byteCount: item.source.byteCount,
    })),
  });
  const preflight = await createDocumentNormalizationPreflightReport({
    binding,
    sourceSnapshotId: scan.snapshotId,
    outputLanguage: policy.publication.language,
    compiler: input.compiler.descriptor,
    envelopes,
    lifecycleByPath: new Map(
      selected.map((item) => [
        item.source.path,
        lifecycle.staleSources.has(item.source.path) ? "stale" : "unrecorded",
      ]),
    ),
    isCached: async (envelope) => {
      const cached = await cache.load(envelope);
      if (cached === null) return false;
      try {
        requiredResponse(cached, envelope);
        return true;
      } catch (error) {
        if (
          error instanceof RepositoryKnowledgeError &&
          ["knowledge_compile_failed", "knowledge_compile_policy_violation"].includes(error.code)
        )
          return false;
        throw error;
      }
    },
    ...(input.ceilings === undefined ? {} : { ceilings: input.ceilings }),
  });
  return {
    scan,
    publicationRoot: policy.publicationRoot,
    outputLanguage: policy.publication.language,
    taxonomy,
    normalizationExclude: policy.normalization?.exclude ?? [],
    selectedPaths,
    cache,
    preflight,
  };
}

export async function createConfiguredDocumentNormalizationPreflight(input: {
  repositoryRoot: string;
  compiler: RepositoryDocumentNormalizationCompiler;
  scope?: DocumentNormalizationScope;
  sourcePaths?: readonly string[];
  ceilings?: Partial<DocumentNormalizationResourceCeilings>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<DocumentNormalizationPreflight> {
  return (
    await prepareConfiguredDocumentNormalization({
      ...input,
    })
  ).preflight;
}

function candidatePath(candidateId: string): string {
  return shardedKnowledgeArtifactPath(
    ".lervo/state/knowledge/normalization-candidates",
    candidateId,
    "json",
  );
}

export async function storeDocumentNormalizationCandidate(input: {
  repositoryRoot: string;
  candidate: DocumentNormalizationCandidate;
}): Promise<{ candidateId: string; artifactPath: string; artifactHash: string; created: boolean }> {
  validateDocumentNormalizationCandidate(input.candidate);
  const root = resolve(input.repositoryRoot);
  const path = candidatePath(input.candidate.candidateId);
  const absolute = resolve(root, path);
  const bytes = Buffer.from(`${canonicalJson(input.candidate)}\n`);
  if (bytes.byteLength > MAX_CANDIDATE_BYTES)
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The document normalization candidate exceeds the artifact limit.",
    );
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
  const existing = await hashAt(absolute);
  if (existing !== null) {
    if (existing !== sha256(bytes))
      throw new RepositoryKnowledgeError(
        "knowledge_compile_failed",
        "Stored document normalization candidate bytes differ for the same ID.",
      );
    return {
      candidateId: input.candidate.candidateId,
      artifactPath: path,
      artifactHash: existing,
      created: false,
    };
  }
  let handle;
  try {
    handle = await open(
      absolute,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close();
  }
  return {
    candidateId: input.candidate.candidateId,
    artifactPath: path,
    artifactHash: sha256(bytes),
    created: true,
  };
}

export async function loadDocumentNormalizationCandidate(input: {
  repositoryRoot: string;
  candidateId: string;
}): Promise<DocumentNormalizationCandidate> {
  if (!/^knorm_[a-f0-9]{24}$/u.test(input.candidateId))
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The document normalization candidate ID is invalid.",
    );
  const absolute = resolve(input.repositoryRoot, candidatePath(input.candidateId));
  const bytes = await readFile(absolute);
  if (bytes.byteLength > MAX_CANDIDATE_BYTES)
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The document normalization candidate is missing or too large.",
    );
  const candidate = JSON.parse(bytes.toString("utf8")) as DocumentNormalizationCandidate;
  if (candidate.candidateId !== input.candidateId)
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "The document normalization candidate failed its path binding.",
    );
  validateDocumentNormalizationCandidate(candidate);
  return candidate;
}

export async function createDocumentNormalizationPlan(input: {
  repositoryRoot: string;
  candidate: DocumentNormalizationCandidate;
  now: Date;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<DocumentNormalizationPlan> {
  const root = resolve(input.repositoryRoot);
  const [{ policy, scan }, taxonomy] = await Promise.all([
    scanConfiguredRepositoryKnowledge(
      root,
      input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources },
    ),
    loadDecisionTaxonomy(root),
  ]);
  await validateDocumentNormalizationCandidateAgainstScan({
    root,
    candidate: input.candidate,
    scan,
    publicationRoot: policy.publicationRoot,
    taxonomy,
    normalizationExclude: policy.normalization?.exclude ?? [],
  });
  const blockers: DocumentNormalizationPlan["blockers"] = [];
  if (
    scan.snapshotId !== input.candidate.sourceSnapshotId ||
    policy.publication.language !== input.candidate.outputLanguage
  )
    blockers.push({ code: "candidate_stale", path: ".lervo/knowledge/policy.yaml" });
  const sources = new Map(scan.sources.map((source) => [source.path, source]));
  const sourcePaths = new Set(input.candidate.items.map((item) => item.sourcePath));
  for (const item of input.candidate.items) {
    if (sources.get(item.sourcePath)?.contentHash !== item.sourceContentHash)
      blockers.push({ code: "candidate_stale", path: item.sourcePath });
    for (const output of item.outputs.filter((output) => output.path !== item.sourcePath)) {
      if (sourcePaths.has(output.path) || (await hashAt(resolve(root, output.path))) !== null)
        blockers.push({ code: "destination_exists", path: output.path });
    }
  }
  void input.now;
  const desiredRecordPaths = new Set(
    input.candidate.items.map(
      (item) => normalizationRecord({ candidate: input.candidate, item }).path,
    ),
  );
  const replacedSources = new Set(input.candidate.items.map((item) => item.sourcePath));
  const obsoleteRecords: DurableKnowledgeDeleteOperation[] = [];
  for (const path of await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/knowledge/document-normalizations",
    extension: "yaml",
    maximumFiles: 20_000,
  })) {
    if (desiredRecordPaths.has(path)) continue;
    try {
      const record = parse(
        await readFile(resolve(root, path), "utf8"),
      ) as Partial<DocumentNormalizationRecord>;
      const contentHash = await hashAt(resolve(root, path));
      if (
        typeof record.sourcePath === "string" &&
        replacedSources.has(record.sourcePath) &&
        contentHash !== null
      ) {
        obsoleteRecords.push({ path, action: "delete", expectedCurrentHash: contentHash });
      }
    } catch {
      /* invalid records remain visible to lint and are never silently deleted */
    }
  }
  const operations: Array<
    DurableKnowledgeUserFileOperation | DurableKnowledgeDeleteOperation | KnowledgeFileOperation
  > = input.candidate.items.flatMap((item) => {
    const outputs: Array<DurableKnowledgeUserFileOperation | KnowledgeFileOperation> =
      item.outputs.map((output) => ({
        path: output.path,
        action: output.path === item.sourcePath ? ("update" as const) : ("create" as const),
        ownership: "user" as const,
        mediaType: "text/markdown" as const,
        content: output.content,
        ...(output.path === item.sourcePath ? { expectedCurrentHash: item.sourceContentHash } : {}),
        desiredHash: output.contentHash,
      }));
    const record = normalizationRecord({ candidate: input.candidate, item });
    outputs.push({
      path: record.path,
      action: "create",
      ownership: "lervo_generated",
      mediaType: "application/yaml",
      content: record.content,
      desiredHash: sha256(record.content),
    });
    return outputs;
  });
  const skillManifestOperations = await projectedSkillManifestOperations({
    repositoryRoot: root,
    scan,
    candidate: input.candidate,
  });
  operations.push(...skillManifestOperations);
  operations.push(...obsoleteRecords);
  const materials = {
    projectId: scan.projectId,
    sourceSnapshotId: scan.snapshotId,
    candidateId: input.candidate.candidateId,
    items: input.candidate.items.map((item) => ({
      operationId: item.operationId,
      approvalHash: item.approvalHash,
    })),
    obsoleteRecords: obsoleteRecords.map((operation) => ({
      path: operation.path,
      expectedCurrentHash: operation.expectedCurrentHash,
    })),
    skillManifestUpdates: skillManifestOperations.map((operation) => ({
      path: operation.path,
      expectedCurrentHash: operation.expectedCurrentHash,
      desiredHash: operation.desiredHash,
    })),
    blockers,
  };
  if (blockers.length === 0)
    await authorizeCurrentRepositoryDocumentLayout({ repositoryRoot: root, operations });
  return {
    schemaVersion: 1,
    planKind: "document_normalization",
    planId: stableId("knormplan", materials),
    status:
      blockers.length > 0
        ? "blocked"
        : input.candidate.items.length === 0
          ? "current"
          : "review_required",
    projectId: scan.projectId,
    repositoryRoot: root,
    sourceSnapshotId: scan.snapshotId,
    candidateId: input.candidate.items.length === 0 ? null : input.candidate.candidateId,
    outputLanguage: input.candidate.outputLanguage,
    formatVersion: input.candidate.formatVersion,
    workset: input.candidate.workset,
    items: input.candidate.items,
    blockers,
    operations,
  };
}

export async function applyDocumentNormalizationPlan(input: {
  plan: DocumentNormalizationPlan;
  candidate: DocumentNormalizationCandidate;
  approvals: Array<{ operationId: string; approvalHash: string }>;
  now: Date;
  recordApplied: (receipt: DocumentNormalizationReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<DocumentNormalizationReceipt> {
  if (
    input.plan.status !== "review_required" ||
    input.plan.candidateId !== input.candidate.candidateId
  )
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The document normalization plan is not applicable.",
    );
  const approvals = new Map(
    input.approvals.map((approval) => [approval.operationId, approval.approvalHash]),
  );
  if (
    approvals.size !== input.plan.items.length ||
    input.plan.items.some(
      (item) =>
        !HASH.test(approvals.get(item.operationId) ?? "") ||
        approvals.get(item.operationId) !== item.approvalHash,
    )
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "Document normalization requires exact approval for every rewritten source document.",
    );
  }
  const current = await createDocumentNormalizationPlan({
    repositoryRoot: input.plan.repositoryRoot,
    candidate: input.candidate,
    now: input.now,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The document normalization source, destination, or policy changed after review.",
    );
  const receipt: DocumentNormalizationReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "normalize_documents",
    planId: current.planId,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    candidateId: input.candidate.candidateId,
    workset: input.candidate.workset,
    approvalDigest: sha256(
      canonicalJson(
        current.items.map((item) => ({
          operationId: item.operationId,
          approvalHash: item.approvalHash,
        })),
      ),
    ),
    normalizedDocumentCount: current.items.length,
    outputDocumentCount: current.items.reduce((sum, item) => sum + item.outputs.length, 0),
    pathDigests: current.items.flatMap((item) => item.outputs.map((output) => sha256(output.path))),
    created: current.operations
      .filter((operation) => operation.action === "create")
      .map((operation) => operation.path),
    updated: current.operations
      .filter((operation) => operation.action === "update")
      .map((operation) => operation.path),
    deleted: current.operations
      .filter((operation) => operation.action === "delete")
      .map((operation) => operation.path),
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: current.repositoryRoot,
      operations: current.operations,
    }),
    receipt,
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}
