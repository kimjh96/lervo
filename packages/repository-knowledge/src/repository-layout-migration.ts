import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { basename, posix, resolve } from "node:path";

import { fromMarkdown } from "mdast-util-from-markdown";
import { parse, stringify } from "yaml";
import {
  conditionalDefaultDocumentRolePath,
  loadDecisionTaxonomy,
  type DecisionTaxonomy,
} from "@lervo/project";

import {
  createKnowledgeMigrationPlanForScan,
  recordedGeneratedKnowledgePaths,
  scanConfiguredRepositoryKnowledge,
} from "./compiler.js";
import { planDecisionTaxonomyRefresh } from "./decision-taxonomy-refresh.js";
import { createKnowledgeInstructionBridgePlan } from "./instruction-bridge.js";
import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeMoveOperation,
  type DurableKnowledgeMoveUpdateOperation,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { listKnowledgeArtifactPaths, shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import {
  relocateRepositoryKnowledgeScanSource,
  repositoryPathCanRemainIncluded,
  upsertRepositoryKnowledgeScanSource,
} from "./scanner.js";
import { createDocumentMoveLineage, loadDocumentMoveLineages } from "./source-lineage.js";
import { loadStoredConcepts } from "./store-reader.js";
import {
  classifyFlatDecision,
  inspectGroupedDecisionPaths,
  type DecisionLayoutBlockerCode,
} from "./decision-layout.js";
import {
  bytePreservedDocumentCollection,
  classifyClaudeRule,
  classifyRepositoryDocument,
  repositoryInstructionPaths,
  type DocumentLayoutBlockerCode,
} from "./document-layout.js";
import {
  RepositoryKnowledgeError,
  type RepositoryKnowledgePreparedScanOptions,
  type KnowledgeFileOperation,
  type RepositoryKnowledgeScanOptions,
  type RepositorySource,
} from "./types.js";
import { repositoryInstructionRouteBlock } from "./instruction-routes.js";
import { providerSurfaceRoles } from "./provider-surface-descriptors.js";
import { projectRebuildableKnowledgeIgnore } from "./projection-ignore.js";

const HASH = /^sha256:[a-f0-9]{64}$/;
const ECOSYSTEM_ROOT_ENTRYPOINTS = new Set([
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
]);

export interface RepositoryLayoutMove {
  operationId: string;
  approvalHash: string;
  fromPath: string;
  toPath: string;
  contentHash: string;
  destinationContentHash: string;
  byteCount: number;
  preservedConceptIds: string[];
  lineageId: string;
  classification:
    | "product"
    | "architecture"
    | "specification"
    | "roadmap"
    | "decision"
    | "document"
    | "instruction"
    | "skill";
  group?: string;
  subgroup?: string;
  routeId?: string;
  classificationBasis?: "explicit_metadata" | "title_terms";
  matchedTitleTerms?: string[];
  reason:
    | "recognized_root_document_role"
    | "recognized_decision_document"
    | "classified_repository_document"
    | "normalized_provider_instruction"
    | "normalized_portable_skill";
}

export interface RepositoryLayoutReferenceUpdate {
  path: string;
  beforeHash: string;
  afterHash: string;
  replacementCount: number;
}

export interface RepositoryLayoutUserUpdate {
  operationId: string;
  approvalHash: string;
  path: string;
  beforeHash: string | null;
  afterHash: string;
  reason:
    | "refresh_instruction_routes"
    | "normalize_agent_surface_references"
    | "reconcile_document_rewriters"
    | "exclude_rebuildable_publications";
}

export interface RepositoryLayoutMachineMove {
  fromPath: string;
  toPath: string;
  contentHash: string;
  byteCount: number;
  registry:
    | "bundles"
    | "concepts"
    | "claims"
    | "relations"
    | "source_lineage"
    | "instruction_bridges"
    | "document_normalizations"
    | "semantic_manifests"
    | "inventory"
    | "source_units"
    | "impacts"
    | "candidates";
}

export interface RepositoryLayoutMigrationPlan {
  schemaVersion: 1;
  planKind: "repository_layout";
  planId: string;
  status: "current" | "ready" | "review_required" | "blocked";
  projectId: string;
  repositoryRoot: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  policyHash: string;
  taxonomyHash: string;
  coverage: {
    included: number;
    excluded: number;
    unsupported: number;
    includedBytes: number;
    complete: boolean;
  };
  registryDigest: string;
  moves: RepositoryLayoutMove[];
  userUpdates: RepositoryLayoutUserUpdate[];
  machineMoves: RepositoryLayoutMachineMove[];
  referenceUpdates: RepositoryLayoutReferenceUpdate[];
  blockers: Array<{
    code:
      | "destination_exists"
      | "ambiguous_destination"
      | "invalid_markdown_reference"
      | DecisionLayoutBlockerCode
      | DocumentLayoutBlockerCode;
    pathDigest: string;
    path?: string;
    candidateRouteIds?: string[];
    configuredMaximum?: number;
    observedCount?: number;
  }>;
  operations: Array<
    | KnowledgeFileOperation
    | DurableKnowledgeMoveOperation
    | DurableKnowledgeMoveUpdateOperation
    | DurableKnowledgeUserFileOperation
  >;
}

export interface RepositoryLayoutMigrationReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "migrate";
  planId: string;
  projectId: string;
  sourceSnapshotId: string;
  afterSourceSnapshotId: string;
  approvalDigest: string;
  movedCount: number;
  machineMovedCount: number;
  referenceUpdatedCount: number;
  pathDigests: Array<{ from: string; to: string }>;
  created: string[];
  updated: string[];
  unchanged: string[];
  appliedAt: string;
}

type RepositoryLayoutCandidate = {
  source: RepositorySource & { content: string; contentHash: string };
} & Pick<RepositoryLayoutMove, "toPath" | "classification" | "reason"> &
  Partial<
    Pick<
      RepositoryLayoutMove,
      "group" | "subgroup" | "routeId" | "classificationBasis" | "matchedTitleTerms"
    >
  > & { instructionPaths?: string[] };

function mediaTypeFor(source: RepositorySource): DurableKnowledgeUserFileOperation["mediaType"] {
  if (/\.mdx?$/iu.test(source.path)) return "text/markdown";
  if (/\.json$/iu.test(source.path)) return "application/json";
  if (/\.ya?ml$/iu.test(source.path)) return "application/yaml";
  if (/\.[cm]?js$/iu.test(source.path)) return "text/javascript";
  if (/\.[cm]?tsx?$/iu.test(source.path)) return "text/typescript";
  return "text/plain";
}

function classifiedRootDestination(
  path: string,
  content: string,
  taxonomy: DecisionTaxonomy,
): Pick<RepositoryLayoutMove, "toPath" | "classification" | "reason"> | null {
  const roles = [...taxonomy.documentPolicy.roles, ...providerSurfaceRoles()];
  const protectedPaths = new Set(
    roles.map((role) => role.path).filter((rolePath) => !rolePath.includes("/")),
  );
  if (
    path.includes("/") ||
    protectedPaths.has(path) ||
    ECOSYSTEM_ROOT_ENTRYPOINTS.has(path) ||
    !/\.md$/iu.test(path)
  )
    return null;
  // An unseeded template still places a recognized document; the plan then binds its role.
  const rolePath = (roleId: string): string | null =>
    taxonomy.documentPolicy.roles.find((role) => role.roleId === roleId)?.path ??
    conditionalDefaultDocumentRolePath(roleId);
  const stem = basename(path, ".md").toUpperCase();
  const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim().toLowerCase() ?? "";
  const visionPath = rolePath("product_vision");
  if (
    visionPath !== null &&
    /(?:^|_)VISION$/u.test(stem) &&
    /(?:vision|\uBE44\uC804)/u.test(heading)
  )
    return {
      toPath: visionPath,
      classification: "product",
      reason: "recognized_root_document_role",
    };
  const architecturePath = rolePath("system_architecture");
  if (
    architecturePath !== null &&
    /(?:^|_)ARCHITECTURE$/u.test(stem) &&
    /(?:architecture|\uC544\uD0A4\uD14D\uCC98|\uAD6C\uC870)/u.test(heading)
  )
    return {
      toPath: architecturePath,
      classification: "architecture",
      reason: "recognized_root_document_role",
    };
  const executionPath = rolePath("execution_specification");
  if (
    executionPath !== null &&
    /(?:^|_)EXECUTION_SPEC$/u.test(stem) &&
    /(?:(?:execution|\uC2E4\uD589).*(?:spec|\uADDC\uACA9)|(?:spec|\uADDC\uACA9).*(?:execution|\uC2E4\uD589))/u.test(
      heading,
    )
  )
    return {
      toPath: executionPath,
      classification: "specification",
      reason: "recognized_root_document_role",
    };
  const versionedPlan = /(?:^|_)V(\d+)_PLAN$/u.exec(stem);
  if (versionedPlan !== null && /(?:plan|\uACC4\uD68D|roadmap|\uB85C\uB4DC\uB9F5)/u.test(heading))
    return {
      toPath: `docs/roadmap/v${versionedPlan[1]}.md`,
      classification: "roadmap",
      reason: "recognized_root_document_role",
    };
  const roadmapPath = rolePath("delivery_roadmap");
  if (
    roadmapPath !== null &&
    /(?:^|_)ROADMAP$/u.test(stem) &&
    /(?:roadmap|\uB85C\uB4DC\uB9F5|\uACC4\uD68D)/u.test(heading)
  )
    return {
      toPath: roadmapPath,
      classification: "roadmap",
      reason: "recognized_root_document_role",
    };
  return null;
}

async function safeFile(
  path: string,
  maximumBytes = 256 * 1024,
): Promise<{ contentHash: string; byteCount: number }> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes)
      throw new Error("unsafe registry item");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    )
      throw new Error("registry changed");
    return { contentHash: sha256(bytes), byteCount: bytes.byteLength };
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The knowledge registry cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

async function machineArtifactMoves(root: string): Promise<RepositoryLayoutMachineMove[]> {
  const registries = [
    {
      directory: ".lervo/knowledge/bundles",
      extension: "yaml" as const,
      registry: "bundles" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/concepts",
      extension: "yaml" as const,
      registry: "concepts" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/claims",
      extension: "yaml" as const,
      registry: "claims" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/relations",
      extension: "yaml" as const,
      registry: "relations" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/source-lineage",
      extension: "yaml" as const,
      registry: "source_lineage" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/instruction-bridges",
      extension: "yaml" as const,
      registry: "instruction_bridges" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/knowledge/document-normalizations",
      extension: "yaml" as const,
      registry: "document_normalizations" as const,
      maximumBytes: 1024 * 1024,
    },
    {
      directory: ".lervo/generated/semantic-manifests",
      extension: "json" as const,
      registry: "semantic_manifests" as const,
      maximumBytes: 16 * 1024 * 1024,
    },
    {
      directory: ".lervo/state/knowledge/candidates",
      extension: "json" as const,
      registry: "candidates" as const,
      maximumBytes: 32 * 1024 * 1024,
    },
  ];
  const moves: RepositoryLayoutMachineMove[] = [];
  for (const item of registries) {
    const paths = await listKnowledgeArtifactPaths({
      root,
      directory: item.directory,
      extension: item.extension,
      maximumFiles: 20_000,
    });
    for (const fromPath of paths.filter(
      (path) => !path.slice(item.directory.length + 1).includes("/"),
    )) {
      const name = fromPath.split("/").at(-1)!;
      const id = name.slice(0, -(item.extension.length + 1));
      const toPath = shardedKnowledgeArtifactPath(item.directory, id, item.extension);
      const file = await safeFile(resolve(root, fromPath), item.maximumBytes);
      moves.push({ fromPath, toPath, ...file, registry: item.registry });
    }
  }
  return moves.sort((left, right) => left.fromPath.localeCompare(right.fromPath));
}

async function normalizationOwnershipUpgradeOperations(
  root: string,
): Promise<KnowledgeFileOperation[]> {
  const operations: KnowledgeFileOperation[] = [];
  const paths = await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/knowledge/document-normalizations",
    extension: "yaml",
    maximumFiles: 20_000,
  });
  for (const path of paths) {
    const source = await readFile(resolve(root, path), "utf8");
    const value = parse(source) as Record<string, unknown>;
    if (value.schemaVersion !== 1) continue;
    const content = stringify(
      {
        ...value,
        schemaVersion: 2,
        byteOwnership: { owner: "reviewer", rewritePolicy: "reviewed_exact" },
      },
      { lineWidth: 0, sortMapEntries: true },
    );
    operations.push({
      path,
      action: "update",
      ownership: "lervo_generated",
      mediaType: "application/yaml",
      content,
      expectedCurrentHash: sha256(source),
      desiredHash: sha256(content),
      reason: "upgrade_document_rewrite_ownership",
    });
  }
  return operations;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function replaceAllLiteral(
  content: string,
  from: string,
  to: string,
): { content: string; count: number } {
  if (from.length === 0 || from === to) return { content, count: 0 };
  const parts = content.split(from);
  return parts.length === 1
    ? { content, count: 0 }
    : { content: parts.join(to), count: parts.length - 1 };
}

function rewriteReferences(
  sourcePath: string,
  content: string,
  moves: Array<{ fromPath: string; toPath: string }>,
): { content: string; count: number } {
  let output = content;
  let count = 0;
  const sourceDirectory = posix.dirname(sourcePath);
  for (const move of moves) {
    const fromRelative = posix.relative(sourceDirectory, move.fromPath);
    const toRelative = posix.relative(sourceDirectory, move.toPath);
    const variants: string[][] = [
      ...(fromRelative.startsWith(".")
        ? [[fromRelative, toRelative]]
        : [
            [`./${fromRelative}`, `./${toRelative}`],
            [fromRelative, toRelative],
          ]),
    ];
    if (move.fromPath !== fromRelative) variants.push([move.fromPath, move.toPath]);
    for (const [from, to] of variants) {
      const replaced = replaceAllLiteral(output, from!, to!);
      output = replaced.content;
      count += replaced.count;
    }
  }
  return { content: output, count };
}

interface PositionedMarkdownNode {
  type?: string;
  url?: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: PositionedMarkdownNode[];
}

function rebaseMarkdownLinks(
  content: string,
  fromPath: string,
  toPath: string,
): { content: string; count: number } {
  const tree = fromMarkdown(content) as PositionedMarkdownNode;
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const visit = (node: PositionedMarkdownNode): void => {
    if (
      (node.type === "link" || node.type === "image" || node.type === "definition") &&
      typeof node.url === "string" &&
      node.url.length > 0 &&
      !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/iu.test(node.url)
    ) {
      const match = /^([^?#]*)([?#].*)?$/u.exec(node.url);
      const relativeTarget = match?.[1] ?? "";
      if (relativeTarget.length > 0) {
        const absoluteTarget = posix.normalize(posix.join(posix.dirname(fromPath), relativeTarget));
        let rebased = posix.relative(posix.dirname(toPath), absoluteTarget);
        if (!rebased.startsWith(".")) rebased = `./${rebased}`;
        rebased += match?.[2] ?? "";
        if (rebased !== node.url) {
          const start = node.position?.start?.offset;
          const end = node.position?.end?.offset;
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
            throw new RepositoryKnowledgeError(
              "knowledge_unit_extraction_failed",
              "The Markdown reference coordinates cannot be determined.",
            );
          const slice = content.slice(start, end);
          const destinationMarker = node.type === "definition" ? "]:" : "](";
          const marker = slice.indexOf(destinationMarker);
          const local =
            marker < 0 ? -1 : slice.indexOf(node.url, marker + destinationMarker.length);
          if (local < 0)
            throw new RepositoryKnowledgeError(
              "knowledge_unit_extraction_failed",
              "The Markdown reference destination cannot be determined.",
            );
          replacements.push({
            start: start! + local,
            end: start! + local + node.url.length,
            value: rebased,
          });
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  let output = content;
  for (const replacement of replacements.sort((left, right) => right.start - left.start))
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
  return { content: output, count: replacements.length };
}

function withoutContent(
  operation:
    | KnowledgeFileOperation
    | DurableKnowledgeMoveOperation
    | DurableKnowledgeMoveUpdateOperation
    | DurableKnowledgeUserFileOperation,
): unknown {
  return operation.action === "move"
    ? operation
    : (({ content: _content, ...item }) => item)(operation);
}

export function serializableRepositoryLayoutMigrationPlan(
  plan: RepositoryLayoutMigrationPlan,
): Omit<RepositoryLayoutMigrationPlan, "operations"> & { operations: unknown[] } {
  return { ...plan, operations: plan.operations.map(withoutContent) };
}

export async function createRepositoryLayoutMigrationPlan(input: {
  repositoryRoot: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  preparedScan?: RepositoryKnowledgePreparedScanOptions["preparedScan"];
}): Promise<RepositoryLayoutMigrationPlan> {
  const root = resolve(input.repositoryRoot);
  const taxonomyPath = resolve(root, ".lervo/knowledge/document-layout.yaml");
  const taxonomySource = await readFile(taxonomyPath, "utf8");
  const [{ policy, scan }, storedConcepts, generatedPaths, taxonomy] = await Promise.all([
    scanConfiguredRepositoryKnowledge(root, {
      ...(input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources }),
      ...(input.preparedScan === undefined ? {} : { preparedScan: input.preparedScan }),
    }),
    loadStoredConcepts(root),
    recordedGeneratedKnowledgePaths(root),
    loadDecisionTaxonomy(root),
  ]);
  if (storedConcepts.some((item) => item.value === null))
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The knowledge concept registry is incomplete.",
      {
        code: "knowledge_concept_registry_incomplete",
        message: "The knowledge concept registry is incomplete.",
      },
    );
  const classificationBlockers: RepositoryLayoutMigrationPlan["blockers"] = [];
  const candidates = scan.sources
    .flatMap<RepositoryLayoutCandidate>((source) => {
      if (
        source.status !== "included" ||
        source.contentHash === null ||
        source.content === undefined
      )
        return [];
      const includedSource = source as RepositorySource & { content: string; contentHash: string };
      const claudeSkill = /^(?:.*\/)?\.claude\/skills\/([^/]+)\/(.+)$/u.exec(source.path);
      if (claudeSkill !== null)
        return [
          {
            source: includedSource,
            toPath: `.agents/skills/${claudeSkill[1]}/${claudeSkill[2]}`,
            classification: "skill" as const,
            reason: "normalized_portable_skill" as const,
          },
        ];
      const instruction = classifyClaudeRule(source.path, source.content, taxonomy);
      if (instruction.kind === "blocked") {
        classificationBlockers.push({
          ...instruction.blocker,
          pathDigest: sha256(instruction.blocker.path),
        });
        return [];
      }
      if (instruction.kind === "classified")
        return [
          {
            source: includedSource,
            ...instruction.route.destination,
            instructionPaths: instruction.route.paths,
            classification: "instruction" as const,
            reason: "normalized_provider_instruction" as const,
          },
        ];
      if (source.kind !== "documentation") return [];
      const decision = classifyFlatDecision(source.path, source.content, taxonomy);
      if (decision.kind === "blocked") {
        classificationBlockers.push({
          ...decision.blocker,
          pathDigest: sha256(decision.blocker.path),
        });
        return [];
      }
      if (decision.kind === "classified")
        return [
          {
            source: includedSource,
            ...decision.destination,
            classification: "decision" as const,
            reason: "recognized_decision_document" as const,
          },
        ];
      const classification = classifiedRootDestination(source.path, source.content, taxonomy);
      if (classification !== null) return [{ source: includedSource, ...classification }];
      const document = classifyRepositoryDocument(source.path, source.content, taxonomy);
      if (document.kind === "blocked") {
        classificationBlockers.push({
          ...document.blocker,
          pathDigest: sha256(document.blocker.path),
        });
        return [];
      }
      return document.kind === "classified"
        ? [
            {
              source: includedSource,
              ...document.destination,
              classification: "document" as const,
              reason: "classified_repository_document" as const,
            },
          ]
        : [];
    })
    .sort((left, right) => left.source.path.localeCompare(right.source.path));
  const repairableDecisionPaths = new Set<string>();
  const lineage = await loadDocumentMoveLineages({
    repositoryRoot: root,
    projectId: scan.projectId,
  });
  const includedSources = new Map(
    scan.sources.flatMap((source) =>
      source.status === "included" && source.content !== undefined && source.contentHash !== null
        ? [
            [
              source.path,
              source as RepositorySource & { content: string; contentHash: string },
            ] as const,
          ]
        : [],
    ),
  );
  const allowedRoutePaths = new Set(taxonomy.routes.map((route) => route.path));
  for (const record of lineage.records.filter((item) => item.activeTerminal)) {
    const name = basename(record.value.toPath);
    const cameFromLegacyFlatRoot = taxonomy.legacyRoots.some(
      (legacyRoot) => record.value.identityPath === `${legacyRoot}/${name}`,
    );
    const canonicalPrefix = `${taxonomy.decisionRoot}/`;
    if (!cameFromLegacyFlatRoot || !record.value.toPath.startsWith(canonicalPrefix)) continue;
    const relativeDestination = record.value.toPath.slice(canonicalPrefix.length);
    const currentRoutePath = relativeDestination.slice(0, relativeDestination.lastIndexOf("/"));
    const isRetiredRoute = !allowedRoutePaths.has(currentRoutePath);
    const isPreviousDefaultFallback =
      taxonomy.taxonomyId === "decisions.default" && currentRoutePath === "foundation";
    if (!isRetiredRoute && !isPreviousDefaultFallback) continue;
    const source = includedSources.get(record.value.toPath);
    if (source === undefined) continue;
    const reclassified = classifyFlatDecision(record.value.identityPath, source.content, taxonomy);
    if (reclassified.kind !== "classified" || reclassified.destination.toPath === source.path)
      continue;
    candidates.push({
      source,
      ...reclassified.destination,
      classification: "decision",
      reason: "recognized_decision_document",
    });
    repairableDecisionPaths.add(source.path);
  }
  candidates.sort((left, right) => left.source.path.localeCompare(right.source.path));
  const destinationCounts = new Map<string, number>();
  for (const item of candidates)
    destinationCounts.set(item.toPath, (destinationCounts.get(item.toPath) ?? 0) + 1);
  const blockers: RepositoryLayoutMigrationPlan["blockers"] = [
    ...classificationBlockers,
    ...inspectGroupedDecisionPaths(
      scan.sources.map((source) => source.path),
      taxonomy,
    )
      .filter(
        (blocker) =>
          blocker.code !== "unknown_decision_route" || !repairableDecisionPaths.has(blocker.path),
      )
      .map((blocker) => ({ ...blocker, pathDigest: sha256(blocker.path) })),
  ];
  const blockedDestinations = new Set<string>();
  for (const item of candidates) {
    if ((destinationCounts.get(item.toPath) ?? 0) > 1) {
      blockers.push({ code: "ambiguous_destination", pathDigest: sha256(item.toPath) });
      blockedDestinations.add(item.toPath);
    } else if (
      scan.sources.some((source) => source.path === item.toPath) ||
      generatedPaths.has(item.toPath) ||
      (await exists(resolve(root, item.toPath)))
    ) {
      blockers.push({ code: "destination_exists", pathDigest: sha256(item.toPath) });
      blockedDestinations.add(item.toPath);
    } else if (!repositoryPathCanRemainIncluded(item.toPath, policy)) {
      blockers.push({ code: "destination_exists", pathDigest: sha256(item.toPath) });
      blockedDestinations.add(item.toPath);
    }
  }
  // Blocked candidates remain represented by their blockers but must never be
  // projected into the virtual post-migration scan. In particular, two source
  // documents that select the same destination would otherwise make the
  // second projection throw instead of returning a reviewable blocked plan.
  const executableCandidates = candidates.filter((item) => !blockedDestinations.has(item.toPath));
  const movePaths = executableCandidates.map(({ source, toPath }) => ({
    fromPath: source.path,
    toPath,
  }));
  const referenceChanges = new Map<
    string,
    {
      source: RepositorySource & { content: string; contentHash: string };
      content: string;
      count: number;
    }
  >();
  const movedContentChanges = new Map<string, { content: string; count: number }>();
  for (const source of scan.sources) {
    if (
      source.status !== "included" ||
      source.content === undefined ||
      source.contentHash === null ||
      generatedPaths.has(source.path) ||
      bytePreservedDocumentCollection(source.path, taxonomy) ||
      source.path.startsWith(".lervo/") ||
      source.path.startsWith("knowledge/")
    )
      continue;
    const move = movePaths.find((item) => item.fromPath === source.path);
    const rebased =
      move === undefined
        ? { content: source.content, count: 0 }
        : rebaseMarkdownLinks(source.content, source.path, move.toPath);
    const rewritten = rewriteReferences(move?.toPath ?? source.path, rebased.content, movePaths);
    rewritten.count += rebased.count;
    if (rewritten.count === 0) continue;
    if (move !== undefined) movedContentChanges.set(source.path, rewritten);
    else
      referenceChanges.set(source.path, {
        source: source as RepositorySource & { content: string; contentHash: string },
        content: rewritten.content,
        count: rewritten.count,
      });
  }
  const instructionCandidates = executableCandidates.filter(
    (item) => item.classification === "instruction",
  );
  const existingInstructions = scan.sources.flatMap((source) =>
    source.status === "included" &&
    source.content !== undefined &&
    source.contentHash !== null &&
    source.path.startsWith("docs/instructions/") &&
    source.path.endsWith(".md")
      ? [{ toPath: source.path, instructionPaths: repositoryInstructionPaths(source.content) }]
      : [],
  );
  const skillCandidates = executableCandidates.filter(
    (item) => item.classification === "skill" && item.toPath.endsWith("/SKILL.md"),
  );
  const existingSkills = scan.sources.flatMap((source) =>
    source.status === "included" &&
    source.path.startsWith(".agents/skills/") &&
    source.path.endsWith("/SKILL.md")
      ? [{ toPath: source.path }]
      : [],
  );
  const routedInstructions =
    instructionCandidates.length > 0 ? instructionCandidates : existingInstructions;
  const routedSkills = skillCandidates.length > 0 ? skillCandidates : existingSkills;
  let managedAgentRouteOperation: KnowledgeFileOperation | null = null;
  const agents = scan.sources.find(
    (source): source is RepositorySource & { content: string; contentHash: string } =>
      source.path === "AGENTS.md" &&
      source.status === "included" &&
      source.content !== undefined &&
      source.contentHash !== null,
  );
  if (agents === undefined && (routedInstructions.length > 0 || routedSkills.length > 0)) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "Provider instruction normalization requires a canonical AGENTS.md source.",
    );
  }
  if (agents !== undefined) {
    const block = repositoryInstructionRouteBlock({
      instructions: routedInstructions.map((item) => ({
        path: item.toPath,
        instructionPaths: item.instructionPaths ?? [],
      })),
      skills: routedSkills.map((item) => ({ path: item.toPath })),
    });
    const blockPattern =
      /<!-- lervo:begin block=repository_instruction_routes schema=\d+ -->[\s\S]*?<!-- lervo:end block=repository_instruction_routes -->\n?/gu;
    const legacyPatternBlock =
      /\n?<!-- lervo:begin block=development_pattern_routes schema=\d+ -->[\s\S]*?<!-- lervo:end block=development_pattern_routes -->\n?/u;
    const existing = referenceChanges.get("AGENTS.md");
    const baseContent = (existing?.content ?? agents.content).replace(legacyPatternBlock, "");
    const existingBlocks = baseContent.match(blockPattern) ?? [];
    let replacedBlock = false;
    const combined =
      existingBlocks.length > 0
        ? baseContent.replace(blockPattern, () => {
            if (replacedBlock) return "";
            replacedBlock = true;
            return block;
          })
        : `${baseContent}${baseContent.endsWith("\n\n") ? "" : baseContent.endsWith("\n") ? "\n" : "\n\n"}${block}`;
    if (combined !== agents.content) {
      if (existing === undefined && (agents.content.match(blockPattern)?.length ?? 0) > 0) {
        managedAgentRouteOperation = {
          path: "AGENTS.md",
          action: "update",
          ownership: "managed_blocks",
          mediaType: "text/markdown",
          content: combined,
          expectedCurrentHash: agents.contentHash,
          desiredHash: sha256(combined),
          reason: "refresh_instruction_registry_bootstrap",
        };
      } else {
        referenceChanges.set("AGENTS.md", {
          source: agents,
          content: combined,
          count: (existing?.count ?? 0) + 1,
        });
      }
    }
  }
  const registryMaterials = await Promise.all(
    storedConcepts.map(async (item) => ({
      file: item.file,
      contentHash: (await safeFile(resolve(root, item.file))).contentHash,
    })),
  );
  registryMaterials.sort((left, right) => left.file.localeCompare(right.file));
  const registryDigest = sha256(canonicalJson(registryMaterials));
  let virtualScan = scan;
  for (const [path, change] of [...movedContentChanges].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    virtualScan = upsertRepositoryKnowledgeScanSource({
      scan: virtualScan,
      path,
      content: change.content,
    });
  }
  for (const change of [...referenceChanges.values()].sort((left, right) =>
    left.source.path.localeCompare(right.source.path),
  )) {
    virtualScan = upsertRepositoryKnowledgeScanSource({
      scan: virtualScan,
      path: change.source.path,
      content: change.content,
    });
  }
  if (managedAgentRouteOperation?.content !== undefined) {
    virtualScan = upsertRepositoryKnowledgeScanSource({
      scan: virtualScan,
      path: "AGENTS.md",
      content: managedAgentRouteOperation.content,
    });
  }
  const moves: RepositoryLayoutMove[] = [];
  const lineageOperations: KnowledgeFileOperation[] = [];
  const moveOperations: Array<DurableKnowledgeMoveOperation | DurableKnowledgeMoveUpdateOperation> =
    [];
  const referenceApprovalBindings = [...referenceChanges.values()]
    .sort((left, right) => left.source.path.localeCompare(right.source.path))
    .map((change) => ({
      path: change.source.path,
      beforeHash: change.source.contentHash,
      afterHash: sha256(change.content),
      replacementCount: change.count,
    }));
  for (const item of executableCandidates) {
    const changedContent = movedContentChanges.get(item.source.path);
    const destinationContentHash =
      changedContent === undefined ? item.source.contentHash! : sha256(changedContent.content);
    const sourceUnits = virtualScan.units.filter((unit) => unit.sourceId === item.source.sourceId);
    const preservedConceptIds = storedConcepts
      .filter(
        (stored) =>
          stored.value?.path === item.source.path &&
          stored.value.ownership === "user" &&
          stored.value.publicationStatus !== "deprecated",
      )
      .map((stored) => stored.value!.conceptId)
      .sort();
    if (preservedConceptIds.length > 1 || sourceUnits.length < 1 || sourceUnits.length > 16384)
      throw new RepositoryKnowledgeError(
        "knowledge_reconciliation_conflict",
        "The layout migration source identity is ambiguous.",
      );
    const operationId = stableId("kdocop", {
      projectId: scan.projectId,
      action: "layout_move",
      sourceId: item.source.sourceId,
      fromPath: item.source.path,
      toPath: item.toPath,
      contentHash: item.source.contentHash,
      destinationContentHash,
      sourceUnitIds: sourceUnits.map((unit) => unit.unitId).sort(),
    });
    const lineage = createDocumentMoveLineage({
      projectId: scan.projectId,
      operationId,
      fromPath: item.source.path,
      toPath: item.toPath,
      identityPath: item.source.identityPath ?? item.source.path,
      sourceId: item.source.sourceId,
      sourceContentHash: destinationContentHash,
      sourceUnitIds: sourceUnits.map((unit) => unit.unitId),
    });
    const approvalHash = sha256(
      canonicalJson({
        operationId,
        action: "move_user_document",
        source: {
          path: item.source.path,
          contentHash: item.source.contentHash,
          byteCount: item.source.byteCount,
        },
        destination: { path: item.toPath, contentHash: destinationContentHash },
        lineageId: lineage.value.lineageId,
        referenceUpdates: referenceApprovalBindings,
      }),
    );
    moves.push({
      operationId,
      approvalHash,
      fromPath: item.source.path,
      toPath: item.toPath,
      contentHash: item.source.contentHash!,
      destinationContentHash,
      byteCount: item.source.byteCount,
      preservedConceptIds,
      lineageId: lineage.value.lineageId,
      classification: item.classification,
      ...(item.group === undefined ? {} : { group: item.group }),
      ...(item.subgroup === undefined ? {} : { subgroup: item.subgroup }),
      ...(item.routeId === undefined ? {} : { routeId: item.routeId }),
      ...(item.classificationBasis === undefined
        ? {}
        : { classificationBasis: item.classificationBasis }),
      ...(item.matchedTitleTerms === undefined
        ? {}
        : { matchedTitleTerms: item.matchedTitleTerms }),
      reason: item.reason,
    });
    lineageOperations.push({
      path: lineage.file,
      action: "create",
      ownership: "lervo_generated",
      mediaType: "application/yaml",
      content: lineage.content,
      desiredHash: sha256(lineage.content),
    });
    moveOperations.push(
      changedContent === undefined
        ? {
            path: item.source.path,
            destinationPath: item.toPath,
            action: "move",
            expectedCurrentHash: item.source.contentHash!,
          }
        : {
            path: item.source.path,
            destinationPath: item.toPath,
            action: "move_update",
            ownership: "user",
            mediaType: "text/markdown",
            expectedCurrentHash: item.source.contentHash!,
            desiredHash: destinationContentHash,
            content: changedContent.content,
          },
    );
    virtualScan = relocateRepositoryKnowledgeScanSource({
      scan: virtualScan,
      fromPath: item.source.path,
      toPath: item.toPath,
    });
  }
  const referenceOperations: DurableKnowledgeUserFileOperation[] = [...referenceChanges.values()]
    .sort((left, right) => left.source.path.localeCompare(right.source.path))
    .map((change) => ({
      path: change.source.path,
      action: "update",
      ownership: "user",
      mediaType: mediaTypeFor(change.source),
      content: change.content,
      expectedCurrentHash: change.source.contentHash,
      desiredHash: sha256(change.content),
    }));
  const referenceUserUpdates: RepositoryLayoutUserUpdate[] =
    moves.length === 0
      ? referenceOperations.map((operation) => {
          const operationId = stableId("kdocop", {
            projectId: scan.projectId,
            action: "refresh_instruction_routes",
            path: operation.path,
            beforeHash: operation.expectedCurrentHash,
            afterHash: operation.desiredHash,
          });
          return {
            operationId,
            approvalHash: sha256(
              canonicalJson({
                operationId,
                action: "update_user_document",
                path: operation.path,
                beforeHash: operation.expectedCurrentHash,
                afterHash: operation.desiredHash,
              }),
            ),
            path: operation.path,
            beforeHash: operation.expectedCurrentHash!,
            afterHash: operation.desiredHash,
            reason:
              operation.path === "AGENTS.md"
                ? ("refresh_instruction_routes" as const)
                : ("normalize_agent_surface_references" as const),
          };
        })
      : [];
  const publicationIgnore = await projectRebuildableKnowledgeIgnore({
    repositoryRoot: root,
    publicationRoot: policy.publicationRoot,
  });
  const publicationIgnoreOperations: DurableKnowledgeUserFileOperation[] = publicationIgnore.changed
    ? [
        {
          path: publicationIgnore.path,
          action: publicationIgnore.beforeContent === null ? "create" : "update",
          ownership: "user",
          mediaType: "text/plain",
          content: publicationIgnore.afterContent,
          ...(publicationIgnore.beforeHash === null
            ? {}
            : { expectedCurrentHash: publicationIgnore.beforeHash }),
          desiredHash: publicationIgnore.afterHash,
        },
      ]
    : [];
  const publicationIgnoreUserUpdates: RepositoryLayoutUserUpdate[] = publicationIgnore.changed
    ? (() => {
        const operationId = stableId("kdocop", {
          projectId: scan.projectId,
          action: "exclude_rebuildable_publications",
          path: publicationIgnore.path,
          beforeHash: publicationIgnore.beforeHash,
          afterHash: publicationIgnore.afterHash,
        });
        return [
          {
            operationId,
            approvalHash: sha256(
              canonicalJson({
                operationId,
                action: "write_user_configuration",
                path: publicationIgnore.path,
                beforeHash: publicationIgnore.beforeHash,
                afterHash: publicationIgnore.afterHash,
              }),
            ),
            path: publicationIgnore.path,
            beforeHash: publicationIgnore.beforeHash,
            afterHash: publicationIgnore.afterHash,
            reason: "exclude_rebuildable_publications" as const,
          },
        ];
      })()
    : [];
  const userUpdates = [...referenceUserUpdates, ...publicationIgnoreUserUpdates];
  const normalizationOwnershipOperations = await normalizationOwnershipUpgradeOperations(root);
  const scannedPaths = new Set(scan.sources.map((source) => source.path));
  const taxonomyUpgradeOperation = planDecisionTaxonomyRefresh({
    taxonomySource,
    taxonomy,
    pathExists: (path) => scannedPaths.has(path),
    placedPaths: new Set(moves.map((move) => move.toPath)),
  });
  const structural =
    publicationIgnoreOperations.length > 0 ||
    (moves.length === 0 &&
      userUpdates.length === 0 &&
      normalizationOwnershipOperations.length === 0 &&
      taxonomyUpgradeOperation.length === 0)
      ? null
      : await createKnowledgeMigrationPlanForScan({
          repositoryRoot: root,
          scan: virtualScan,
          mode: "migrate",
        });
  if (structural?.operations.some((operation) => operation.action === "conflict"))
    blockers.push({ code: "destination_exists", pathDigest: sha256("structural-output-conflict") });
  const bridgeOperations: KnowledgeFileOperation[] = [];
  const canonicalInstructionChange =
    referenceChanges.get("AGENTS.md") ??
    (managedAgentRouteOperation?.content === undefined
      ? undefined
      : { content: managedAgentRouteOperation.content });
  const existingInstructionBridgeRecords = await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/knowledge/instruction-bridges",
    extension: "yaml",
    maximumFiles: 64,
  });
  if (
    canonicalInstructionChange !== undefined &&
    existingInstructionBridgeRecords.length > 0 &&
    (await exists(resolve(root, "CLAUDE.md")))
  ) {
    const bridge = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
      ...(input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources }),
    });
    if (bridge.target.action !== "unchanged")
      throw new RepositoryKnowledgeError(
        "knowledge_reconciliation_conflict",
        "The instruction bridge target must be current before repository layout migration.",
      );
    const currentRecord = bridge.operations.find(
      (operation): operation is KnowledgeFileOperation =>
        operation.path === bridge.bridgeRecordPath && operation.ownership !== "user",
    );
    if (currentRecord === undefined || currentRecord.action === "conflict")
      throw new RepositoryKnowledgeError(
        "knowledge_reconciliation_conflict",
        "The instruction bridge record cannot be bound to the layout migration.",
      );
    const content = stringify(
      {
        schemaVersion: 1,
        bridgeId: bridge.bridgeId,
        profile: {
          id: bridge.profile.profileId,
          version: bridge.profile.profileVersion,
          provider: bridge.profile.provider,
          discoveryContract: bridge.profile.discoveryContract,
        },
        canonical: {
          path: bridge.profile.canonicalPath,
          contentHash: sha256(canonicalInstructionChange.content),
        },
        target: {
          path: bridge.profile.targetPath,
          contentHash:
            referenceChanges.get(bridge.profile.targetPath) === undefined
              ? bridge.target.afterHash
              : sha256(referenceChanges.get(bridge.profile.targetPath)!.content),
          blockId: bridge.profile.blockId,
          managedContentHash: bridge.target.managedContentHash,
        },
      },
      { lineWidth: 0, sortMapEntries: true },
    );
    const desiredHash = sha256(content);
    bridgeOperations.push(
      currentRecord.action === "create"
        ? { ...currentRecord, content, desiredHash }
        : currentRecord.desiredHash === desiredHash
          ? { ...currentRecord, action: "unchanged", desiredHash }
          : {
              path: bridge.bridgeRecordPath,
              action: "update",
              ownership: "lervo_generated",
              mediaType: "application/yaml",
              content,
              expectedCurrentHash:
                currentRecord.action === "unchanged"
                  ? currentRecord.desiredHash
                  : currentRecord.expectedCurrentHash!,
              desiredHash,
            },
    );
  }
  const structuralPaths = new Set(
    (structural?.operations ?? []).map((operation) => operation.path),
  );
  const machineMoves = (await machineArtifactMoves(root)).filter(
    (move) => !structuralPaths.has(move.fromPath) && !structuralPaths.has(move.toPath),
  );
  for (const move of machineMoves) {
    if (await exists(resolve(root, move.toPath)))
      blockers.push({ code: "destination_exists", pathDigest: sha256(move.toPath) });
  }
  const machineMoveOperations: DurableKnowledgeMoveOperation[] = machineMoves.map((move) => ({
    path: move.fromPath,
    destinationPath: move.toPath,
    action: "move",
    expectedCurrentHash: move.contentHash,
  }));
  const operations: RepositoryLayoutMigrationPlan["operations"] = [
    ...taxonomyUpgradeOperation,
    ...normalizationOwnershipOperations,
    ...(structural?.operations ?? []),
    ...publicationIgnoreOperations,
    ...(managedAgentRouteOperation === null ? [] : [managedAgentRouteOperation]),
    ...referenceOperations,
    ...bridgeOperations,
    ...lineageOperations,
    ...moveOperations,
    ...machineMoveOperations,
  ];
  const taxonomyHash = sha256(canonicalJson(taxonomy));
  const policyHash = sha256(canonicalJson({ knowledge: policy, decisionTaxonomy: taxonomy }));
  const status =
    blockers.length > 0
      ? "blocked"
      : moves.length > 0 || userUpdates.length > 0
        ? "review_required"
        : machineMoves.length > 0 ||
            managedAgentRouteOperation !== null ||
            taxonomyUpgradeOperation.length > 0 ||
            normalizationOwnershipOperations.length > 0
          ? "ready"
          : "current";
  const materials = {
    projectId: scan.projectId,
    sourceSnapshotId: scan.snapshotId,
    afterSourceSnapshotId: virtualScan.snapshotId,
    policyHash,
    taxonomyHash,
    registryDigest,
    moves,
    userUpdates,
    machineMoves,
    referenceUpdates: referenceOperations.map(withoutContent),
    operations: operations.map(withoutContent),
    blockers,
  };
  const referenceUpdates: RepositoryLayoutReferenceUpdate[] = [
    ...[...referenceChanges.values()].map((change) => ({
      path: change.source.path,
      beforeHash: change.source.contentHash,
      afterHash: sha256(change.content),
      replacementCount: change.count,
    })),
    ...executableCandidates.flatMap((item) => {
      const change = movedContentChanges.get(item.source.path);
      return change === undefined
        ? []
        : [
            {
              path: item.toPath,
              beforeHash: item.source.contentHash!,
              afterHash: sha256(change.content),
              replacementCount: change.count,
            },
          ];
    }),
  ].sort((left, right) => left.path.localeCompare(right.path));
  if (blockers.length === 0)
    await authorizeCurrentRepositoryDocumentLayout({ repositoryRoot: root, operations });
  return {
    schemaVersion: 1,
    planKind: "repository_layout",
    planId: stableId("klayout", materials),
    status,
    projectId: scan.projectId,
    repositoryRoot: root,
    sourceSnapshotId: scan.snapshotId,
    afterSourceSnapshotId: virtualScan.snapshotId,
    policyHash,
    taxonomyHash,
    coverage: scan.coverage,
    registryDigest,
    moves,
    userUpdates,
    machineMoves,
    referenceUpdates,
    blockers,
    operations,
  };
}

export async function applyRepositoryLayoutMigrationPlan(input: {
  plan: RepositoryLayoutMigrationPlan;
  approvals: Array<{ operationId: string; approvalHash: string }>;
  now: Date;
  recordApplied: (receipt: RepositoryLayoutMigrationReceipt) => void | Promise<void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<RepositoryLayoutMigrationReceipt> {
  if (input.plan.status !== "review_required" && input.plan.status !== "ready")
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The repository layout migration plan is not applicable.",
    );
  const approvalItems = [...input.plan.moves, ...input.plan.userUpdates];
  const approvalMap = new Map(input.approvals.map((item) => [item.operationId, item.approvalHash]));
  if (
    approvalMap.size !== approvalItems.length ||
    approvalItems.some(
      (item) =>
        !HASH.test(approvalMap.get(item.operationId) ?? "") ||
        approvalMap.get(item.operationId) !== item.approvalHash,
    )
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "Repository layout migration requires exact item approval for every user-document move or update.",
    );
  }
  const current = await createRepositoryLayoutMigrationPlan({
    repositoryRoot: input.plan.repositoryRoot,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "A source, destination, reference, or policy changed after repository layout migration was planned.",
    );
  const approvalDigest = sha256(
    canonicalJson(
      [...current.moves, ...current.userUpdates].map((item) => ({
        operationId: item.operationId,
        approvalHash: item.approvalHash,
      })),
    ),
  );
  const receipt: RepositoryLayoutMigrationReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "migrate",
    planId: current.planId,
    projectId: current.projectId,
    sourceSnapshotId: current.sourceSnapshotId,
    afterSourceSnapshotId: current.afterSourceSnapshotId,
    approvalDigest,
    movedCount: current.moves.length,
    machineMovedCount: current.machineMoves.length,
    referenceUpdatedCount: current.referenceUpdates.length,
    pathDigests: current.moves.map((move) => ({
      from: sha256(move.fromPath),
      to: sha256(move.toPath),
    })),
    created: current.operations
      .filter((operation) => operation.action === "create")
      .map((operation) => operation.path),
    updated: current.operations
      .filter((operation) => operation.action === "update")
      .map((operation) => operation.path),
    unchanged: current.operations
      .filter((operation) => operation.action === "unchanged")
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
