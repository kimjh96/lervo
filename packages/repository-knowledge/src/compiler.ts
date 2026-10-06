import { lstat, readFile } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import { stringify } from "yaml";

import { listKnowledgeArtifactPaths, shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { analyzeRepositoryKnowledgeImpact } from "./impact.js";
import { loadRepositoryKnowledgePolicy } from "./policy.js";
import { scanRepositoryKnowledge } from "./scanner.js";
import {
  currentKnowledgeProjectionOutputs,
  legacyKnowledgeProjectionDeleteOperations,
} from "./state-projections.js";
import type {
  KnowledgeFileOperation,
  KnowledgeMigrationPlan,
  RepositoryKnowledgeScan,
  RepositoryKnowledgeScanOptions,
  RepositoryKnowledgePreparedScanOptions,
  RepositorySource,
  RepositorySourceUnit,
  RepositoryEntrypointDisposition,
} from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";
import { assertNoKnowledgeMaterializationTransaction } from "./materialization-owner.js";
import { summarizeRepositoryAgentArtifacts } from "./agent-artifact-summary.js";
import {
  repositoryPublicationMessages,
  type RepositoryPublicationGroup,
  type RepositoryPublicationMessages,
} from "./publication-language.js";
import {
  repositoryKnowledgePublicationSnapshotId,
  repositorySourceCanEnterStructuralPublication,
} from "./publication-snapshot.js";
import { repositoryInstructionPaths } from "./document-layout.js";
import { archiveScopes, historicalDocumentMarker } from "./historical-documents.js";
import { repositoryInstructionRouteBlock } from "./instruction-routes.js";
import { summarizeIncrementalReconciliation } from "./incremental-reconciliation.js";
import { loadDocumentLayoutContract } from "./document-layout-contract.js";
import {
  isRebuildableStructuralProjectionPath,
  legacyStructuralBundleDirectory,
  legacyStructuralConceptDirectory,
  legacyStructuralManifestDirectory,
  structuralBundleDirectory,
  structuralConceptDirectory,
  structuralManifestDirectory,
  structuralManifestPath,
  structuralProjectionLayoutVersion,
} from "./structural-projection.js";
import {
  isRegeneratableStructuralPublication,
  structuralPublicationHeader,
} from "./structural-publication-ownership.js";

interface GeneratedOutputRecord {
  path: string;
  contentHash: string;
}

interface GenerationManifest {
  schemaVersion: 1 | 2;
  generationId: string;
  projectId: string;
  sourceSnapshotId: string;
  compiler: {
    id: "lervo.structural";
    version: "1" | "2";
    capability: "bounded_read_only_no_tools";
  };
  outputs: GeneratedOutputRecord[];
}

interface DesiredOutput extends GeneratedOutputRecord {
  mediaType: KnowledgeFileOperation["mediaType"];
  content: string;
}

interface ConceptSidecar {
  schemaVersion: 1;
  conceptId: string;
  bundleId: string;
  type: "concept" | "decision" | "invariant" | "procedure" | "responsibility";
  publicationProfile: "reference" | "explanation" | "architecture_context";
  publicationLanguage: string;
  title: string;
  path: string;
  ownership: "user" | "lervo_generated";
  publicationStatus: "draft" | "stable" | "deprecated";
  sourceUnitVersionIds: string[];
  assurance: "unreviewed";
  freshness: "current" | "stale";
}

function yaml(value: unknown): string {
  return stringify(value, { lineWidth: 0, sortMapEntries: true });
}

function titleFor(
  source: RepositorySource,
  language = "en",
  fallbackTitle = "Repository source",
): string {
  const firstHeading = source.content?.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (firstHeading !== undefined && !(language === "en" && /[\u3131-\uD79D]/u.test(firstHeading)))
    return firstHeading;
  const segments = source.path.split("/");
  const fallback =
    basename(source.path).toLocaleLowerCase() === "skill.md"
      ? (segments.at(-2) ?? "skill")
      : basename(source.path, extname(source.path));
  const normalized = fallback.replaceAll(/[-_]/g, " ");
  return language === "en" && /[\u3131-\u318E\uAC00-\uD7A3]/u.test(normalized)
    ? fallbackTitle
    : normalized;
}

function conceptType(source: RepositorySource): ConceptSidecar["type"] {
  if (source.kind === "instruction") return "invariant";
  if (source.agentArtifact?.role === "skill" || source.agentArtifact?.role === "legacy_command")
    return "procedure";
  if (source.agentArtifact?.role === "agent_definition") return "responsibility";
  if (/(^|\/)adr\/|(^|\/)decisions?\//i.test(source.path)) return "decision";
  if (/(runbook|how-to|guide|procedure)/i.test(source.path)) return "procedure";
  if (/(ownership|maintainer|codeowners)/i.test(source.path)) return "responsibility";
  return "concept";
}

function profile(source: RepositorySource): ConceptSidecar["publicationProfile"] {
  if (/(architecture|vision)/i.test(source.path)) return "architecture_context";
  if (source.kind === "instruction" || source.agentArtifact !== undefined) return "reference";
  return "explanation";
}

function markdownLink(indexPath: string, target: string): string {
  const from = resolve("/repository", indexPath, "..");
  const to = resolve("/repository", target);
  return relative(from, to).split(sep).join("/").split("/").map(encodeURIComponent).join("/");
}

function groupKey(
  source: RepositorySource,
  archiveScopePaths: readonly string[],
): RepositoryPublicationGroup | null {
  if (
    source.kind === "documentation" &&
    historicalDocumentMarker({
      path: source.path,
      content: source.content,
      archiveScopes: archiveScopePaths,
    }) !== null
  )
    return "historical";
  if (source.agentArtifact?.role === "behavioral_instruction" || source.kind === "instruction")
    return "agent_instructions";
  if (source.agentArtifact?.role === "skill" || source.agentArtifact?.role === "legacy_command")
    return "agent_workflows";
  if (source.agentArtifact?.role === "agent_definition") return "agent_definitions";
  if (source.kind === "documentation") {
    if (/(architecture|vision)/i.test(source.path)) return "architecture";
    if (/(^|\/)adr\//i.test(source.path)) return "decisions";
    if (/(^|\/)(specs?|reference)\//i.test(source.path)) return "specifications";
    return "documentation";
  }
  return null;
}

const groupDefinitions = [
  { key: "agent_instructions", slug: "instructions", profile: "reference" as const },
  { key: "agent_workflows", slug: "agent-workflows", profile: "reference" as const },
  { key: "agent_definitions", slug: "agent-definitions", profile: "reference" as const },
  { key: "architecture", slug: "architecture", profile: "architecture_context" as const },
  { key: "specifications", slug: "specifications", profile: "reference" as const },
  { key: "decisions", slug: "decisions", profile: "reference" as const },
  { key: "documentation", slug: "documentation", profile: "explanation" as const },
  { key: "historical", slug: "historical", profile: "explanation" as const },
] as const;

function documentGroups(
  documents: RepositorySource[],
  archiveScopePaths: readonly string[],
): Map<RepositoryPublicationGroup, RepositorySource[]> {
  const groups = new Map<RepositoryPublicationGroup, RepositorySource[]>();
  for (const source of documents) {
    const key = groupKey(source, archiveScopePaths);
    if (key === null) continue;
    const values = groups.get(key) ?? [];
    values.push(source);
    groups.set(key, values);
  }
  return groups;
}

function structuralOverview(input: {
  indexPath: string;
  scan: RepositoryKnowledgeScan;
  groups: Map<RepositoryPublicationGroup, RepositorySource[]>;
  messages: RepositoryPublicationMessages;
}): string {
  const counts = new Map<string, number>();
  const eligibleSources = input.scan.sources.filter(repositorySourceCanEnterStructuralPublication);
  const publicationSources = eligibleSources.filter((item) => item.status === "included");
  for (const source of publicationSources) {
    counts.set(source.kind, (counts.get(source.kind) ?? 0) + 1);
  }
  const lines = [
    structuralPublicationHeader,
    `# ${input.messages.repositoryKnowledge}`,
    "",
    `> ${input.messages.generatedOverview}`,
    "",
    `## ${input.messages.inventory}`,
    "",
    input.messages.publicationSnapshot({
      snapshotId: repositoryKnowledgePublicationSnapshotId(input.scan),
      included: publicationSources.length,
      includedBytes: publicationSources.reduce((total, source) => total + source.byteCount, 0),
      excluded: eligibleSources.filter((item) => item.status === "excluded").length,
      unsupported: eligibleSources.filter((item) => item.status === "unsupported").length,
    }),
    "",
    ...[...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, count]) => `- ${kind}: ${count}`),
  ];
  lines.push("", `## ${input.messages.knowledgeMap}`, "");
  for (const definition of groupDefinitions) {
    const sources = input.groups.get(definition.key);
    if (sources === undefined || sources.length === 0) continue;
    const categoryPath = `${input.indexPath.slice(0, input.indexPath.lastIndexOf("/") + 1)}${definition.slug}.md`;
    lines.push(
      `- [${input.messages.groups[definition.key]}](${markdownLink(input.indexPath, categoryPath)}) — ${input.messages.itemCount(sources.length, "concept")}`,
    );
  }
  if ([...input.groups.values()].every((items) => items.length === 0)) {
    lines.push("", `## ${input.messages.startingPoint}`, "", input.messages.noPublications);
  }
  lines.push(
    "",
    `## ${input.messages.evidenceSemantics}`,
    "",
    input.messages.evidenceExplanation,
    "",
  );
  return lines.join("\n");
}

function categoryPublication(input: {
  title: string;
  path: string;
  lines: string[];
  messages: RepositoryPublicationMessages;
}): string {
  return [
    structuralPublicationHeader,
    `# ${input.title}`,
    "",
    `> ${input.messages.generatedNavigation}`,
    "",
    ...input.lines,
    "",
  ].join("\n");
}

function sourceNavigationLine(
  path: string,
  source: RepositorySource,
  language: string,
  messages: RepositoryPublicationMessages,
  historical: boolean,
): string {
  const title = titleFor(source, language, messages.sourceTitleFallback).slice(0, 160);
  const label = historical ? ` — ${messages.historicalLabel}` : "";
  return `- [${title}](${markdownLink(path, source.path)}) — \`${source.path}\`${label}`;
}

function assertNavigationBound(path: string, content: string, maxBytes: number): void {
  if (Buffer.byteLength(content) > maxBytes) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      `${path} navigation publication exceeds the policy byte limit.`,
    );
  }
}

function categoryPublications(input: {
  label: string;
  slug: string;
  path: string;
  sources: RepositorySource[];
  messages: RepositoryPublicationMessages;
  maxEntries: number;
  maxBytes: number;
  language: string;
  historical: boolean;
}): Array<Omit<DesiredOutput, "contentHash">> {
  const direct = categoryPublication({
    title: input.label,
    path: input.path,
    lines: input.sources.map((source) =>
      sourceNavigationLine(input.path, source, input.language, input.messages, input.historical),
    ),
    messages: input.messages,
  });
  if (input.sources.length <= input.maxEntries && Buffer.byteLength(direct) <= input.maxBytes) {
    return [{ path: input.path, mediaType: "text/markdown", content: direct }];
  }

  const pages: Array<{ path: string; content: string; count: number }> = [];
  let current: RepositorySource[] = [];
  const publishPage = (): void => {
    if (current.length === 0) return;
    const pageNumber = pages.length + 1;
    const pagePath = `${input.path.slice(0, -3)}/page-${String(pageNumber).padStart(3, "0")}.md`;
    const content = categoryPublication({
      title: `${input.label} — ${input.messages.page} ${pageNumber}`,
      path: pagePath,
      lines: current.map((source) =>
        sourceNavigationLine(pagePath, source, input.language, input.messages, input.historical),
      ),
      messages: input.messages,
    });
    assertNavigationBound(pagePath, content, input.maxBytes);
    pages.push({ path: pagePath, content, count: current.length });
    current = [];
  };
  for (const source of input.sources) {
    const candidate = [...current, source];
    const pageNumber = pages.length + 1;
    const pagePath = `${input.path.slice(0, -3)}/page-${String(pageNumber).padStart(3, "0")}.md`;
    const candidateContent = categoryPublication({
      title: `${input.label} — ${input.messages.page} ${pageNumber}`,
      path: pagePath,
      lines: candidate.map((item) =>
        sourceNavigationLine(pagePath, item, input.language, input.messages, input.historical),
      ),
      messages: input.messages,
    });
    if (
      current.length > 0 &&
      (candidate.length > input.maxEntries || Buffer.byteLength(candidateContent) > input.maxBytes)
    )
      publishPage();
    current.push(source);
    if (current.length === 1) {
      const single = categoryPublication({
        title: `${input.label} — ${input.messages.page} ${pages.length + 1}`,
        path: pagePath,
        lines: [
          sourceNavigationLine(pagePath, source, input.language, input.messages, input.historical),
        ],
        messages: input.messages,
      });
      assertNavigationBound(pagePath, single, input.maxBytes);
    }
  }
  publishPage();

  const pageLines = (path: string, values: typeof pages): string[] =>
    values.map(
      (page, index) =>
        `- [${input.messages.page} ${index + 1}](${markdownLink(path, page.path)}) — ${input.messages.itemCount(page.count, "document")}`,
    );
  let rootLines = pageLines(input.path, pages);
  let rootContent = categoryPublication({
    title: input.label,
    path: input.path,
    lines: rootLines,
    messages: input.messages,
  });
  const catalogs: Array<{ path: string; content: string; count: number }> = [];
  if (rootLines.length > input.maxEntries || Buffer.byteLength(rootContent) > input.maxBytes) {
    for (let offset = 0; offset < pages.length; offset += input.maxEntries) {
      const values = pages.slice(offset, offset + input.maxEntries);
      const catalogNumber = catalogs.length + 1;
      const catalogPath = `${input.path.slice(0, -3)}/catalog-${String(catalogNumber).padStart(3, "0")}.md`;
      const content = categoryPublication({
        title: `${input.label} — ${input.messages.catalog} ${catalogNumber}`,
        path: catalogPath,
        lines: values.map(
          (page, index) =>
            `- [${input.messages.page} ${offset + index + 1}](${markdownLink(catalogPath, page.path)}) — ${input.messages.itemCount(page.count, "document")}`,
        ),
        messages: input.messages,
      });
      assertNavigationBound(catalogPath, content, input.maxBytes);
      catalogs.push({
        path: catalogPath,
        content,
        count: values.reduce((total, value) => total + value.count, 0),
      });
    }
    rootLines = catalogs.map(
      (catalog, index) =>
        `- [${input.messages.catalog} ${index + 1}](${markdownLink(input.path, catalog.path)}) — ${input.messages.itemCount(catalog.count, "document")}`,
    );
    rootContent = categoryPublication({
      title: input.label,
      path: input.path,
      lines: rootLines,
      messages: input.messages,
    });
  }
  assertNavigationBound(input.path, rootContent, input.maxBytes);
  return [
    { path: input.path, mediaType: "text/markdown", content: rootContent },
    ...catalogs.map(({ path, content }) => ({
      path,
      mediaType: "text/markdown" as const,
      content,
    })),
    ...pages.map(({ path, content }) => ({ path, mediaType: "text/markdown" as const, content })),
  ];
}

async function previousGenerated(root: string): Promise<{
  paths: Set<string>;
  structuralPaths: Set<string>;
  hashes: Map<string, Set<string>>;
  structuralManifestPaths: Set<string>;
}> {
  const paths = new Set<string>();
  const structuralPaths = new Set<string>();
  const hashes = new Map<string, Set<string>>();
  const structuralManifestPaths = new Set<string>();
  for (const relativeDirectory of [
    legacyStructuralManifestDirectory,
    structuralManifestDirectory,
    ".lervo/generated/semantic-manifests",
  ]) {
    const manifestFiles = await listKnowledgeArtifactPaths({
      root,
      directory: relativeDirectory,
      extension: "json",
      maximumFiles: 20_000,
    });
    for (const manifestPath of manifestFiles) {
      try {
        const manifestBytes = await readFile(resolve(root, manifestPath));
        const value = JSON.parse(manifestBytes.toString("utf8")) as Partial<GenerationManifest> & {
          kind?: unknown;
        };
        if (
          (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
          typeof value.generationId !== "string" ||
          typeof value.projectId !== "string" ||
          typeof value.sourceSnapshotId !== "string" ||
          !Array.isArray(value.outputs) ||
          !value.outputs.every(
            (output) => typeof output?.path === "string" && typeof output.contentHash === "string",
          )
        )
          continue;
        if (
          (relativeDirectory === legacyStructuralManifestDirectory ||
            relativeDirectory === structuralManifestDirectory) &&
          (value.compiler?.id !== "lervo.structural" ||
            !["1", "2"].includes(value.compiler.version) ||
            value.compiler.capability !== "bounded_read_only_no_tools")
        )
          continue;
        if (
          relativeDirectory === ".lervo/generated/semantic-manifests" &&
          value.kind !== "semantic"
        )
          continue;
        if (
          relativeDirectory === legacyStructuralManifestDirectory ||
          relativeDirectory === structuralManifestDirectory
        ) {
          structuralManifestPaths.add(manifestPath);
          const manifestHashes = hashes.get(manifestPath) ?? new Set<string>();
          manifestHashes.add(sha256(manifestBytes));
          hashes.set(manifestPath, manifestHashes);
        }
        for (const output of value.outputs) {
          if (typeof output?.path !== "string" || typeof output.contentHash !== "string") continue;
          const recordedPaths = new Set([output.path, canonicalGeneratedArtifactPath(output.path)]);
          for (const recordedPath of recordedPaths) {
            paths.add(recordedPath);
            if (
              relativeDirectory === legacyStructuralManifestDirectory ||
              relativeDirectory === structuralManifestDirectory
            )
              structuralPaths.add(recordedPath);
            const values = hashes.get(recordedPath) ?? new Set<string>();
            values.add(output.contentHash);
            hashes.set(recordedPath, values);
          }
        }
      } catch {
        // Invalid old manifests are diagnosed by lint; they never grant write ownership.
      }
    }
  }
  return { paths, structuralPaths, hashes, structuralManifestPaths };
}

const generatedArtifactRegistries = [
  { directory: legacyStructuralBundleDirectory, extension: "yaml" as const },
  { directory: legacyStructuralConceptDirectory, extension: "yaml" as const },
  { directory: structuralBundleDirectory, extension: "yaml" as const },
  { directory: structuralConceptDirectory, extension: "yaml" as const },
  { directory: ".lervo/knowledge/claims", extension: "yaml" as const },
  { directory: ".lervo/knowledge/relations", extension: "yaml" as const },
  { directory: ".lervo/knowledge/source-lineage", extension: "yaml" as const },
  { directory: ".lervo/knowledge/instruction-bridges", extension: "yaml" as const },
  { directory: ".lervo/generated/semantic-manifests", extension: "json" as const },
] as const;

function canonicalGeneratedArtifactPath(path: string): string {
  for (const registry of generatedArtifactRegistries) {
    const prefix = `${registry.directory}/`;
    const suffix = `.${registry.extension}`;
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (name.includes("/") || !name.endsWith(suffix)) return path;
    const id = name.slice(0, -suffix.length);
    try {
      return shardedKnowledgeArtifactPath(registry.directory, id, registry.extension);
    } catch {
      return path;
    }
  }
  return path;
}

export async function recordedGeneratedKnowledgePaths(
  repositoryRoot: string,
): Promise<ReadonlySet<string>> {
  return (await previousGenerated(resolve(repositoryRoot))).paths;
}

export async function matchesRecordedStructuralGeneration(
  repositoryRoot: string,
  path: string,
  contentHash: string,
): Promise<boolean> {
  const previous = await previousGenerated(resolve(repositoryRoot));
  return previous.structuralPaths.has(path) && previous.hashes.get(path)?.has(contentHash) === true;
}

function sourceFileUnit(
  scan: RepositoryKnowledgeScan,
  source: RepositorySource,
): RepositorySourceUnit | undefined {
  return scan.units.find((item) => item.sourceId === source.sourceId && item.unitKind === "file");
}

function desiredOutputs(input: {
  scan: RepositoryKnowledgeScan;
  projectName: string;
  generatedPaths: ReadonlySet<string>;
  publicationRoot: string;
  publication: {
    language: import("./publication-language.js").RepositoryPublicationLanguage;
    maxNavigationEntries: number;
    maxNavigationBytes: number;
  };
  archiveScopes: readonly string[];
}): {
  outputs: DesiredOutput[];
  registeredUserDocuments: number;
  generatedConcepts: number;
  entrypoints: KnowledgeMigrationPlan["entrypoints"];
} {
  const messages = repositoryPublicationMessages(input.publication.language);
  const sourcePaths = new Set(input.scan.sources.map((source) => source.path));
  const disposition = (
    path: RepositoryEntrypointDisposition["path"],
    audience: RepositoryEntrypointDisposition["audience"],
    missingAction: RepositoryEntrypointDisposition["action"],
  ): RepositoryEntrypointDisposition =>
    sourcePaths.has(path)
      ? {
          path,
          audience,
          status: "present",
          action: "preserve_user",
          reason: "Existing user-owned bytes are never rewritten by structural migration.",
        }
      : input.generatedPaths.has(path)
        ? {
            path,
            audience,
            status: "present_generated",
            action: missingAction,
            reason:
              "The current bytes are a recorded Lervo generation and may be refreshed deterministically.",
          }
        : {
            path,
            audience,
            status: "missing",
            action: missingAction,
            reason:
              missingAction === "provider_bridge_required"
                ? "Provider entrypoints are created only through an explicit, profiled bridge plan."
                : "The canonical entrypoint is absent, so migration can create a bounded generated starting point.",
          };
  const entrypoints: KnowledgeMigrationPlan["entrypoints"] = {
    readme: disposition("README.md", "human", "create_generated"),
    agents: disposition("AGENTS.md", "agent", "create_generated"),
    claude: disposition("CLAUDE.md", "provider_agent", "provider_bridge_required"),
  };
  const documents = input.scan.sources.filter((source) => {
    if (
      source.status !== "included" ||
      source.content === undefined ||
      (!source.path.endsWith(".md") && !source.path.endsWith(".mdx"))
    )
      return false;
    if (source.kind === "documentation" || source.kind === "instruction") return true;
    return (
      source.agentArtifact?.role === "skill" ||
      source.agentArtifact?.role === "legacy_command" ||
      source.agentArtifact?.role === "agent_definition"
    );
  });
  const instructionRouteBlock = repositoryInstructionRouteBlock({
    instructions: input.scan.sources.flatMap((source) =>
      source.status === "included" &&
      source.content !== undefined &&
      source.path.startsWith("docs/instructions/") &&
      source.path.endsWith(".md")
        ? [{ path: source.path, instructionPaths: repositoryInstructionPaths(source.content) }]
        : [],
    ),
    skills: input.scan.sources.flatMap((source) =>
      source.status === "included" &&
      source.path.startsWith(".agents/skills/") &&
      source.path.endsWith("/SKILL.md")
        ? [{ path: source.path }]
        : [],
    ),
  });
  const publicationSourceIds = new Set(
    input.scan.sources
      .filter(repositorySourceCanEnterStructuralPublication)
      .map((source) => source.sourceId),
  );
  const publicationSnapshotId = repositoryKnowledgePublicationSnapshotId(input.scan);
  const bundleId = stableId("bundle", {
    projectId: input.scan.projectId,
    purpose: "repository-knowledge",
  });
  const indexPath = `${input.publicationRoot.replace(/\/$/, "")}/index.md`;
  const groups = documentGroups(documents, input.archiveScopes);
  const generatedConceptId = stableId("concept", {
    projectId: input.scan.projectId,
    role: "repository-index",
  });
  const concepts: ConceptSidecar[] = [];
  concepts.push({
    schemaVersion: 1,
    conceptId: generatedConceptId,
    bundleId,
    type: "concept",
    publicationProfile: "reference",
    publicationLanguage: input.publication.language,
    title: messages.repositoryKnowledge,
    path: indexPath,
    ownership: "lervo_generated",
    publicationStatus: "draft",
    sourceUnitVersionIds: input.scan.units
      .filter((item) => item.unitKind === "file" && publicationSourceIds.has(item.sourceId))
      .map((item) => item.unitVersionId),
    assurance: "unreviewed",
    freshness: "current",
  });
  const categoryOutputs: Array<Omit<DesiredOutput, "contentHash">> = [];
  let activeCategoryCount = 0;
  for (const definition of groupDefinitions) {
    const sources = groups.get(definition.key) ?? [];
    const categoryPath = `${input.publicationRoot.replace(/\/$/, "")}/${definition.slug}.md`;
    if (sources.length === 0) continue;
    activeCategoryCount += 1;
    const label = messages.groups[definition.key];
    const categoryConceptId = stableId("concept", {
      projectId: input.scan.projectId,
      role: `repository-${definition.slug}`,
    });
    concepts.push({
      schemaVersion: 1,
      conceptId: categoryConceptId,
      bundleId,
      type: "concept",
      publicationProfile: definition.profile,
      publicationLanguage: input.publication.language,
      title: label,
      path: categoryPath,
      ownership: "lervo_generated",
      publicationStatus: "draft",
      sourceUnitVersionIds: sources
        .map((source) => sourceFileUnit(input.scan, source)?.unitVersionId)
        .filter((item): item is string => item !== undefined),
      assurance: "unreviewed",
      freshness: "current",
    });
    categoryOutputs.push(
      ...categoryPublications({
        label,
        slug: definition.slug,
        path: categoryPath,
        sources,
        messages,
        maxEntries: input.publication.maxNavigationEntries,
        maxBytes: input.publication.maxNavigationBytes,
        language: input.publication.language,
        historical: definition.key === "historical",
      }),
    );
  }
  for (const source of documents) {
    const sourceUnit = sourceFileUnit(input.scan, source);
    if (sourceUnit === undefined) continue;
    concepts.push({
      schemaVersion: 1,
      conceptId: stableId("concept", {
        projectId: input.scan.projectId,
        sourceId: source.sourceId,
      }),
      bundleId,
      type: conceptType(source),
      publicationProfile: profile(source),
      publicationLanguage: input.publication.language,
      title: titleFor(source, input.publication.language, messages.sourceTitleFallback),
      path: source.path,
      ownership: "user",
      publicationStatus: "stable",
      sourceUnitVersionIds: [sourceUnit.unitVersionId],
      assurance: "unreviewed",
      freshness: "current",
    });
  }

  const base: Array<Omit<DesiredOutput, "contentHash">> = [
    ...(entrypoints.readme.action === "create_generated"
      ? [
          {
            path: "README.md",
            mediaType: "text/markdown" as const,
            content: [
              "<!-- lervo:generated repository-entrypoint-v1 -->",
              `# ${input.projectName}`,
              "",
              messages.generatedReadmeSummary,
              "",
              `## ${messages.readmeStartHeading}`,
              "",
              `- ${messages.repositoryKnowledgeEntry(indexPath)}`,
              ...messages.readmeRules.map((rule) => `- ${rule}`),
              "",
            ].join("\n"),
          },
        ]
      : []),
    ...(entrypoints.agents.action === "create_generated"
      ? [
          {
            path: "AGENTS.md",
            mediaType: "text/markdown" as const,
            content: [
              "<!-- lervo:generated repository-agent-entrypoint-v1 -->",
              `# ${messages.agentsTitle}`,
              "",
              messages.generatedAgentsPurpose,
              "",
              ...messages.agentRules.map((rule) => `- ${rule}`),
              "",
              instructionRouteBlock.trimEnd(),
              "",
            ].join("\n"),
          },
        ]
      : []),
    {
      path: indexPath,
      mediaType: "text/markdown",
      content: structuralOverview({ indexPath, scan: input.scan, groups, messages }),
    },
    ...categoryOutputs,
    {
      path: shardedKnowledgeArtifactPath(structuralBundleDirectory, bundleId, "yaml"),
      mediaType: "application/yaml",
      content: yaml({
        schemaVersion: 1,
        bundleId,
        title: messages.repositoryKnowledge,
        publicationLanguage: input.publication.language,
        entryPath: indexPath,
        publicationRoot: input.publicationRoot,
        conceptIds: concepts.map((concept) => concept.conceptId),
        sourceSnapshotId: publicationSnapshotId,
        assurance: "unreviewed",
      }),
    },
    ...concepts.map((concept) => ({
      path: shardedKnowledgeArtifactPath(structuralConceptDirectory, concept.conceptId, "yaml"),
      mediaType: "application/yaml" as const,
      content: yaml(concept),
    })),
  ];
  const outputs = base.map((output) => ({ ...output, contentHash: sha256(output.content) }));
  return {
    outputs,
    registeredUserDocuments: documents.length,
    generatedConcepts: 1 + activeCategoryCount,
    entrypoints,
  };
}

async function inspectOperation(input: {
  root: string;
  output: DesiredOutput;
  previousHashes: Map<string, Set<string>>;
  repairMode: KnowledgeMigrationPlan["repairMode"];
  publicationRoot: string;
}): Promise<KnowledgeFileOperation> {
  const desired = {
    path: input.output.path,
    mediaType: input.output.mediaType,
    content: input.output.content,
    desiredHash: input.output.contentHash,
  };
  const absolute = resolve(input.root, input.output.path);
  const fromRoot = relative(input.root, absolute);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === "..") {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      `Output path escapes the repository: ${input.output.path}`,
    );
  }
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return {
        ...desired,
        action: "conflict",
        ownership: "lervo_generated",
        reason: "target_is_not_regular_file",
      };
    }
    const current = await readFile(absolute);
    const currentHash = sha256(current);
    if (currentHash === input.output.contentHash) {
      return {
        ...desired,
        action: "unchanged",
        ownership: "lervo_generated",
        expectedCurrentHash: currentHash,
      };
    }
    if (
      input.previousHashes.get(input.output.path)?.has(currentHash) === true ||
      isRebuildableStructuralProjectionPath(input.output.path) ||
      input.output.path.startsWith(".lervo/state/knowledge/")
    ) {
      return {
        ...desired,
        action: "update",
        ownership: "lervo_generated",
        expectedCurrentHash: currentHash,
      };
    }
    if (
      isRegeneratableStructuralPublication({
        path: input.output.path,
        publicationRoot: input.publicationRoot,
        currentContent: current,
        desiredContent: input.output.content,
      })
    ) {
      return {
        ...desired,
        action: "update",
        ownership: "lervo_generated",
        expectedCurrentHash: currentHash,
        reason: "regenerate_edited_generated_publication",
      };
    }
    if (
      input.repairMode === "replace_unrecorded_structural_records" &&
      /^\.lervo\/knowledge\/(?:bundles|concepts)\/[a-f0-9]{2}\/(?:bundle|concept)_[a-f0-9]{24}\.yaml$/u.test(
        input.output.path,
      )
    ) {
      return {
        ...desired,
        action: "update",
        ownership: "lervo_generated",
        expectedCurrentHash: currentHash,
        reason: "repair_unrecorded_structural_record",
      };
    }
    return {
      ...desired,
      action: "conflict",
      ownership: "lervo_generated",
      expectedCurrentHash: currentHash,
      reason: "existing_bytes_are_not_a_recorded_lervo_generation",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...desired, action: "create", ownership: "lervo_generated" };
    }
    throw error;
  }
}

async function inspectDeleteOperation(input: {
  root: string;
  path: string;
  previousHashes: Map<string, Set<string>>;
}): Promise<KnowledgeFileOperation | null> {
  const absolute = resolve(input.root, input.path);
  const fromRoot = relative(input.root, absolute);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === "..") {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      `Delete path escapes the repository: ${input.path}`,
    );
  }
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    const currentHash = sha256(await readFile(absolute));
    if (input.previousHashes.get(input.path)?.has(currentHash) !== true) return null;
    return {
      path: input.path,
      action: "delete",
      ownership: "lervo_generated",
      mediaType: input.path.endsWith(".md")
        ? "text/markdown"
        : input.path.endsWith(".yaml")
          ? "application/yaml"
          : "application/json",
      expectedCurrentHash: currentHash,
      desiredHash: sha256("lervo:absent\n"),
      reason: "no_longer_generated",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function createKnowledgeMigrationPlan(input: {
  repositoryRoot: string;
  mode?: "migrate" | "refresh";
  repairMode?: KnowledgeMigrationPlan["repairMode"];
  reconciliationMode?: KnowledgeMigrationPlan["reconciliation"]["strategy"];
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  preparedScan?: RepositoryKnowledgePreparedScanOptions["preparedScan"];
}): Promise<KnowledgeMigrationPlan> {
  const root = resolve(input.repositoryRoot);
  const { manifest, policy, scan, previous } = await configuredRepositoryKnowledgeScan(root, {
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
    ...(input.preparedScan === undefined ? {} : { preparedScan: input.preparedScan }),
  });
  return buildKnowledgeMigrationPlan({
    root,
    manifest,
    policy,
    scan,
    previous,
    mode: input.mode ?? "migrate",
    repairMode: input.repairMode ?? "none",
    reconciliationMode: input.reconciliationMode ?? "full",
  });
}

async function buildKnowledgeMigrationPlan(input: {
  root: string;
  manifest: Awaited<ReturnType<typeof loadProjectManifest>>;
  policy: Awaited<ReturnType<typeof loadRepositoryKnowledgePolicy>>;
  scan: RepositoryKnowledgeScan;
  previous: Awaited<ReturnType<typeof previousGenerated>>;
  mode: "migrate" | "refresh";
  repairMode: KnowledgeMigrationPlan["repairMode"];
  reconciliationMode: KnowledgeMigrationPlan["reconciliation"]["strategy"];
}): Promise<KnowledgeMigrationPlan> {
  const { root, manifest, policy, scan, previous } = input;
  const layout = await loadDocumentLayoutContract(root);
  const compilation = desiredOutputs({
    scan,
    projectName: manifest.name,
    generatedPaths: previous.structuralPaths,
    publicationRoot: policy.publicationRoot,
    publication: policy.publication,
    archiveScopes: archiveScopes(layout.taxonomy),
  });
  const impact = await analyzeRepositoryKnowledgeImpact({ repositoryRoot: root, scan });
  const reconciliation = await summarizeIncrementalReconciliation({
    repositoryRoot: root,
    scan,
    strategy: input.reconciliationMode,
  });
  const structuralOutputs: DesiredOutput[] = [
    ...compilation.outputs,
    ...currentKnowledgeProjectionOutputs(scan, impact),
  ];
  const generationOutputs = structuralOutputs;
  const publicationSnapshotId = repositoryKnowledgePublicationSnapshotId(scan);
  const generationId = stableId("gen", {
    projectId: manifest.projectId,
    sourceSnapshotId: publicationSnapshotId,
    outputs: generationOutputs.map(({ path, contentHash }) => ({ path, contentHash })),
    compiler: "lervo.structural@2",
  });
  const generationManifest: GenerationManifest = {
    schemaVersion: structuralProjectionLayoutVersion,
    generationId,
    projectId: manifest.projectId,
    sourceSnapshotId: publicationSnapshotId,
    compiler: { id: "lervo.structural", version: "2", capability: "bounded_read_only_no_tools" },
    outputs: generationOutputs.map(({ path, contentHash }) => ({ path, contentHash })),
  };
  const manifestContent = `${JSON.stringify(generationManifest, null, 2)}\n`;
  const allOutputs: DesiredOutput[] = [
    ...structuralOutputs,
    {
      path: structuralManifestPath,
      mediaType: "application/json",
      content: manifestContent,
      contentHash: sha256(manifestContent),
    },
  ];
  const desiredPaths = new Set(generationOutputs.map((output) => output.path));
  const staleOperations = (
    await Promise.all(
      [...previous.structuralPaths]
        .filter((path) => !desiredPaths.has(path))
        .map((path) => inspectDeleteOperation({ root, path, previousHashes: previous.hashes })),
    )
  ).filter((operation): operation is KnowledgeFileOperation => operation !== null);
  const staleManifestOperations = (
    await Promise.all(
      [...previous.structuralManifestPaths]
        .filter((path) => path !== structuralManifestPath)
        .map((path) => inspectDeleteOperation({ root, path, previousHashes: previous.hashes })),
    )
  ).filter((operation): operation is KnowledgeFileOperation => operation !== null);
  const derivedStateOperations = await legacyKnowledgeProjectionDeleteOperations(root);
  const blockers = layout.blockers;
  const operations = [
    ...(await Promise.all(
      allOutputs.map((output) =>
        inspectOperation({
          root,
          output,
          previousHashes: previous.hashes,
          repairMode: input.repairMode,
          publicationRoot: policy.publicationRoot,
        }),
      ),
    )),
    ...staleOperations,
    ...staleManifestOperations,
    ...derivedStateOperations,
  ];
  operations.sort((left, right) => left.path.localeCompare(right.path));
  const planMaterials = {
    projectId: manifest.projectId,
    sourceSnapshotId: scan.snapshotId,
    policyHash: sha256(canonicalJson(policy)),
    compiler: "lervo.structural@2",
    repairMode: input.repairMode,
    reconciliation,
    operations: operations.map((operation) =>
      operation.action === "delete"
        ? operation
        : (({ content: _content, ...value }) => value)(operation),
    ),
    blockers,
  };
  return {
    schemaVersion: 1,
    planId: stableId("kplan", planMaterials),
    projectId: manifest.projectId,
    repositoryRoot: root,
    status:
      blockers.length > 0 || operations.some((operation) => operation.action === "conflict")
        ? "blocked"
        : "ready",
    mode: input.mode,
    repairMode: input.repairMode,
    reconciliation,
    sourceSnapshotId: scan.snapshotId,
    policyHash: planMaterials.policyHash,
    compiler: { id: "lervo.structural", version: "2", capability: "bounded_read_only_no_tools" },
    coverage: scan.coverage,
    impact: impact.summary,
    impactReportId: impact.reportId,
    operations,
    blockers,
    registeredUserDocuments: compilation.registeredUserDocuments,
    generatedConcepts: compilation.generatedConcepts,
    entrypoints: compilation.entrypoints,
    agentArtifacts: summarizeRepositoryAgentArtifacts(scan),
  };
}

export async function createKnowledgeMigrationPlanForScan(input: {
  repositoryRoot: string;
  scan: RepositoryKnowledgeScan;
  mode?: "migrate" | "refresh";
}): Promise<KnowledgeMigrationPlan> {
  const root = resolve(input.repositoryRoot);
  await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root });
  const [manifest, policy, previous] = await Promise.all([
    loadProjectManifest(root),
    loadRepositoryKnowledgePolicy(root),
    previousGenerated(root),
  ]);
  if (manifest.projectId !== input.scan.projectId || policy.policyId !== input.scan.policyId) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The virtual knowledge scan project or policy differs from the current repository.",
    );
  }
  return buildKnowledgeMigrationPlan({
    root,
    manifest,
    policy,
    scan: input.scan,
    previous,
    mode: input.mode ?? "refresh",
    repairMode: "none",
    reconciliationMode: "full",
  });
}

async function configuredRepositoryKnowledgeScan(
  repositoryRoot: string,
  options: RepositoryKnowledgeScanOptions &
    RepositoryKnowledgePreparedScanOptions & { allowTransactionPlanId?: string } = {},
): Promise<{
  manifest: Awaited<ReturnType<typeof loadProjectManifest>>;
  policy: Awaited<ReturnType<typeof loadRepositoryKnowledgePolicy>>;
  scan: RepositoryKnowledgeScan;
  previous: Awaited<ReturnType<typeof previousGenerated>>;
}> {
  const root = resolve(repositoryRoot);
  await assertNoKnowledgeMaterializationTransaction({
    repositoryRoot: root,
    ...(options.allowTransactionPlanId === undefined
      ? {}
      : { allowedPlanId: options.allowTransactionPlanId }),
  });
  const manifest = await loadProjectManifest(root);
  const policy = await loadRepositoryKnowledgePolicy(root);
  const previous = await previousGenerated(root);
  const scan =
    options.preparedScan ??
    (await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: manifest.projectId,
      policy,
      generatedPaths: previous.paths,
      ...(options.supplementalSources === undefined
        ? {}
        : { supplementalSources: options.supplementalSources }),
    }));
  if (scan.projectId !== manifest.projectId || scan.policyId !== policy.policyId) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The prepared knowledge scan project or policy differs from the current repository.",
    );
  }
  return { manifest, policy, scan, previous };
}

export async function scanConfiguredRepositoryKnowledge(
  repositoryRoot: string,
  options: RepositoryKnowledgeScanOptions &
    RepositoryKnowledgePreparedScanOptions & { allowTransactionPlanId?: string } = {},
): Promise<{
  manifest: Awaited<ReturnType<typeof loadProjectManifest>>;
  policy: Awaited<ReturnType<typeof loadRepositoryKnowledgePolicy>>;
  scan: RepositoryKnowledgeScan;
}> {
  const { manifest, policy, scan } = await configuredRepositoryKnowledgeScan(
    repositoryRoot,
    options,
  );
  return { manifest, policy, scan };
}
