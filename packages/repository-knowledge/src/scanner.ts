import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";

import { isIgnorableFilesystemMetadata } from "./filesystem-metadata.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { loadDocumentMoveLineages } from "./source-lineage.js";
import type {
  RepositoryKnowledgePolicy,
  RepositoryKnowledgeScan,
  RepositorySource,
  RepositorySourceKind,
  RepositorySupplementalSource,
  RepositorySourceUnit,
} from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";
import {
  extractJavaScriptSymbolSpans,
  JAVASCRIPT_SOURCE_UNIT_ADAPTER,
} from "./javascript-source-units.js";
import { extractCssSymbolSpans, CSS_SOURCE_UNIT_ADAPTER } from "./css-source-units.js";
import { extractJsonKeySpans, JSON_SOURCE_UNIT_ADAPTER } from "./json-source-units.js";
import { extractYamlKeySpans, YAML_SOURCE_UNIT_ADAPTER } from "./yaml-source-units.js";
import {
  extractSkillContractUnitDescriptors,
  SKILL_CONTRACT_SOURCE_UNIT_ADAPTER,
} from "./skill-contract-source-units.js";
import {
  GIT_REVISION_SOURCE_ADAPTER,
  GIT_REVISION_SOURCE_PATH,
  observeGitHeadRevision,
  type ObserveGitRevision,
} from "./git-revision-source.js";
import { repositoryAgentArtifactForPath } from "./agent-artifact-profile.js";

const binaryExtensions = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".db",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".pdf",
  ".png",
  ".pyc",
  ".sqlite",
  ".sqlite3",
  ".tar",
  ".ttf",
  ".wasm",
  ".webp",
  ".woff",
  ".woff2",
  ".xz",
  ".zip",
]);

const secretName =
  /(^|\/)(\.env(?:\.|$)|[^/]*(?:secret|credential|token)[^/]*|id_[dr]sa|[^/]*\.(?:pem|key|p12|pfx))$/i;
const decisionDocumentName = /(?:^|\/)(?:adr|decisions)(?:\/[^/]+)*\/\d{4}-.+\.md$/iu;

function secretCandidatePath(path: string): boolean {
  return secretName.test(path) && !decisionDocumentName.test(path);
}
const instructionName = /(^|\/)(GEMINI\.md)$/i;
const testPath = /(^|\/)(test|tests|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const schemaPath = /(^|\/)(schemas?|migrations?)\/|\.schema\.json$/i;
const buildName =
  /(^|\/)(package\.json|pnpm-workspace\.yaml|Cargo\.toml|go\.mod|Makefile|Dockerfile|docker-compose[^/]*|.*\.(?:gradle|csproj|sln))$/i;
const logPath = /(^|\/)(logs?|traces?)\/|\.(?:log|out)$/i;
const configExtension = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini"]);
const codeExtension = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".m",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

export function repositorySourceKindForPath(path: string): RepositorySourceKind {
  const extension = extname(path).toLowerCase();
  if (decisionDocumentName.test(path)) return "documentation";
  const agentArtifact = repositoryAgentArtifactForPath(path);
  if (agentArtifact?.role === "behavioral_instruction") return "instruction";
  if (agentArtifact?.role === "skill" || agentArtifact?.role === "skill_resource")
    return "skill_contract";
  if (agentArtifact?.role === "legacy_command") return "agent_workflow";
  if (agentArtifact?.role === "agent_definition") return "agent_definition";
  if (agentArtifact?.role === "execution_policy") return "execution_policy";
  if (agentArtifact !== undefined) return "agent_configuration";
  if (instructionName.test(path)) return "instruction";
  if (testPath.test(path)) return "test";
  if (schemaPath.test(path)) return "schema";
  if (buildName.test(path)) return "build_definition";
  if (logPath.test(path)) return "log";
  if (extension === ".md" || extension === ".mdx" || extension === ".rst" || extension === ".txt") {
    return "documentation";
  }
  if (configExtension.has(extension)) return "configuration";
  if (codeExtension.has(extension)) return "code";
  return "other";
}

function globExpression(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escaped.replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*")}$`,
  );
}

function excluded(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (globExpression(pattern).test(path)) return true;
    return pattern.endsWith("/**") && globExpression(pattern.slice(0, -3)).test(path);
  });
}

function generatedEntrypoint(path: string, content: string): boolean {
  return (
    (path === "README.md" &&
      content.startsWith("<!-- lervo:generated repository-entrypoint-v1 -->\n")) ||
    (path === "AGENTS.md" &&
      content.startsWith("<!-- lervo:generated repository-agent-entrypoint-v1 -->\n"))
  );
}

export function repositoryPathMatchesPatterns(path: string, patterns: readonly string[]): boolean {
  return excluded(path, patterns);
}

export function repositoryPathCanRemainIncluded(
  path: string,
  policy: RepositoryKnowledgePolicy,
): boolean {
  return !excluded(path, policy.exclude) && !secretCandidatePath(path);
}

export function repositorySourceClassificationForPath(path: string): "ordinary" | "sensitive" {
  if (decisionDocumentName.test(path)) return "ordinary";
  if (repositoryAgentArtifactForPath(path)?.contentHandling === "local_inventory_only")
    return "sensitive";
  if (logPath.test(path)) return "sensitive";
  return /(^|\/)(SECURITY|PRIVATE)(\.md)?$/i.test(path) ? "sensitive" : "ordinary";
}

function agentArtifactFields(
  path: string,
): Pick<RepositorySource, "agentArtifact"> | Record<string, never> {
  const agentArtifact = repositoryAgentArtifactForPath(path);
  return agentArtifact === undefined ? {} : { agentArtifact };
}

function opaqueSkillResourceFields(
  path: string,
): Pick<RepositorySource, "agentArtifact"> | Record<string, never> {
  const agentArtifact = repositoryAgentArtifactForPath(path);
  if (agentArtifact?.role !== "skill_resource") return {};
  return { agentArtifact: { ...agentArtifact, contentHandling: "opaque_resource" } };
}

async function safeReadFile(path: string, expectedSize: number): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expectedSize) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        `${path} changed during the scan.`,
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        `${path} changed during the scan.`,
      );
    }
    return bytes;
  } finally {
    await handle?.close();
  }
}

function byteOffset(value: string, characterOffset: number): number {
  return Buffer.byteLength(value.slice(0, characterOffset));
}

function unit(input: {
  projectId: string;
  source: RepositorySource & { content: string; contentHash: string };
  unitKind: RepositorySourceUnit["unitKind"];
  locator: string;
  startCharacter: number;
  endCharacter: number;
  startByte?: number;
  endByte?: number;
  startLine: number;
  endLine: number;
  title?: string;
  adapter?: string;
  versionBinding?: "source" | "unit";
}): RepositorySourceUnit {
  const bytes = input.source.content.slice(input.startCharacter, input.endCharacter);
  const unitHash = sha256(bytes);
  const unitId = stableId("unit", {
    projectId: input.projectId,
    sourceKind: input.source.kind,
    path: input.source.identityPath ?? input.source.path,
    unitKind: input.unitKind,
    locator: input.locator,
  });
  return {
    unitId,
    unitVersionId: stableId("uv", {
      unitId,
      ...(input.versionBinding === "unit" ? {} : { sourceHash: input.source.contentHash }),
      unitHash,
      adapter: input.adapter ?? "repository-source-unit-v1",
      ...(input.versionBinding === "unit" ? { versionBinding: "unit" } : {}),
    }),
    sourceId: input.source.sourceId,
    sourceHash: input.source.contentHash,
    unitHash,
    unitKind: input.unitKind,
    path: input.source.path,
    locator: input.locator,
    range: {
      startByte: input.startByte ?? byteOffset(input.source.content, input.startCharacter),
      endByte: input.endByte ?? byteOffset(input.source.content, input.endCharacter),
      startLine: input.startLine,
      endLine: input.endLine,
    },
    ...(input.title === undefined ? {} : { title: input.title }),
  };
}

function coordinateMap(
  value: string,
  offsets: number[],
): Map<number, { byte: number; line: number }> {
  const sorted = [...new Set(offsets)].sort((left, right) => left - right);
  const output = new Map<number, { byte: number; line: number }>();
  let previous = 0;
  let byte = 0;
  let line = 1;
  for (const offset of sorted) {
    if (!Number.isSafeInteger(offset) || offset < previous || offset > value.length) {
      throw new RepositoryKnowledgeError(
        "knowledge_unit_extraction_failed",
        "The source unit coordinates are invalid.",
      );
    }
    const segment = value.slice(previous, offset);
    byte += Buffer.byteLength(segment);
    line += segment.match(/\n/g)?.length ?? 0;
    output.set(offset, { byte, line });
    previous = offset;
  }
  return output;
}

function yamlKeyUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
): RepositorySourceUnit[] {
  const extension = extname(source.path).toLowerCase();
  if (extension !== ".yaml" && extension !== ".yml") return [];
  const spans = extractYamlKeySpans(source.content);
  const coordinates = coordinateMap(
    source.content,
    spans.flatMap((span) => [span.startCharacter, span.endCharacter]),
  );
  return spans.map((span) =>
    unit({
      projectId,
      source,
      unitKind: "config_key",
      locator: span.locator,
      startCharacter: span.startCharacter,
      endCharacter: span.endCharacter,
      startByte: coordinates.get(span.startCharacter)!.byte,
      endByte: coordinates.get(span.endCharacter)!.byte,
      startLine: coordinates.get(span.startCharacter)!.line,
      endLine: coordinates.get(span.endCharacter)!.line,
      title: span.pointer,
      adapter: YAML_SOURCE_UNIT_ADAPTER,
      versionBinding: "unit",
    }),
  );
}

function markdownUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
): RepositorySourceUnit[] {
  const headings = [...source.content.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)];
  const ranges = headings.map((match, index) => ({
    start: match.index,
    end: headings[index + 1]?.index ?? source.content.length,
  }));
  const coordinates = coordinateMap(
    source.content,
    ranges.flatMap(({ start, end }) => [start, end]),
  );
  return headings.map((match, index) => {
    const start = match.index;
    const end = ranges[index]?.end ?? source.content.length;
    const title = match[2]?.trim() ?? "untitled";
    const depth = match[1]?.length ?? 1;
    const parentTitles: string[] = [];
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = headings[cursor];
      if ((previous?.[1]?.length ?? 0) < depth) {
        parentTitles.unshift(previous?.[2]?.trim() ?? "untitled");
        if ((previous?.[1]?.length ?? 0) === 1) break;
      }
    }
    return unit({
      projectId,
      source,
      unitKind: "markdown_section",
      locator: `heading:${[...parentTitles, title].join(" > ")}`,
      startCharacter: start,
      endCharacter: end,
      startByte: coordinates.get(start)!.byte,
      endByte: coordinates.get(end)!.byte,
      startLine: coordinates.get(start)!.line,
      endLine: coordinates.get(end)!.line,
      title,
    });
  });
}

function codeSymbolUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
): RepositorySourceUnit[] {
  if (!/[.][cm]?[jt]sx?$/.test(source.path)) return [];
  const spans = extractJavaScriptSymbolSpans(source.content, source.path);
  const coordinates = coordinateMap(
    source.content,
    spans.flatMap((span) => [span.startCharacter, span.endCharacter]),
  );
  return spans.map((span) =>
    unit({
      projectId,
      source,
      unitKind: "code_symbol",
      locator: span.locator,
      startCharacter: span.startCharacter,
      endCharacter: span.endCharacter,
      startByte: coordinates.get(span.startCharacter)!.byte,
      endByte: coordinates.get(span.endCharacter)!.byte,
      startLine: coordinates.get(span.startCharacter)!.line,
      endLine: coordinates.get(span.endCharacter)!.line,
      title: span.qualifiedName,
      adapter: JAVASCRIPT_SOURCE_UNIT_ADAPTER,
      versionBinding: "unit",
    }),
  );
}

function jsonKeyUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
): RepositorySourceUnit[] {
  if (extname(source.path).toLowerCase() !== ".json") return [];
  const spans = extractJsonKeySpans(source.content);
  const coordinates = coordinateMap(
    source.content,
    spans.flatMap((span) => [span.startCharacter, span.endCharacter]),
  );
  return spans.map((span) =>
    unit({
      projectId,
      source,
      unitKind: "config_key",
      locator: span.locator,
      startCharacter: span.startCharacter,
      endCharacter: span.endCharacter,
      startByte: coordinates.get(span.startCharacter)!.byte,
      endByte: coordinates.get(span.endCharacter)!.byte,
      startLine: coordinates.get(span.startCharacter)!.line,
      endLine: coordinates.get(span.endCharacter)!.line,
      title: span.pointer,
      adapter: JSON_SOURCE_UNIT_ADAPTER,
      versionBinding: "unit",
    }),
  );
}

function extractUnits(
  projectId: string,
  source: RepositorySource & { content: string; contentHash: string },
): RepositorySourceUnit[] {
  if (source.kind === "revision_metadata") {
    return [
      unit({
        projectId,
        source,
        unitKind: "revision",
        locator: "revision:HEAD",
        startCharacter: 0,
        endCharacter: source.content.length,
        startByte: 0,
        endByte: Buffer.byteLength(source.content),
        startLine: 1,
        endLine: 1,
        title: "Git HEAD commit",
        adapter: GIT_REVISION_SOURCE_ADAPTER,
        versionBinding: "unit",
      }),
    ];
  }
  const fileUnit = unit({
    projectId,
    source,
    unitKind: "file",
    locator: "file:/",
    startCharacter: 0,
    endCharacter: source.content.length,
    startLine: 1,
    endLine: source.content.split("\n").length,
    title: basename(source.path),
  });
  const cssSpans = source.path.toLocaleLowerCase().endsWith(".css")
    ? extractCssSymbolSpans(source.content)
    : [];
  const cssCoordinates = coordinateMap(
    source.content,
    cssSpans.flatMap((span) => [span.startCharacter, span.endCharacter]),
  );
  return [
    fileUnit,
    ...(source.path.endsWith(".md") || source.path.endsWith(".mdx")
      ? markdownUnits(projectId, source)
      : []),
    ...codeSymbolUnits(projectId, source),
    ...jsonKeyUnits(projectId, source),
    ...yamlKeyUnits(projectId, source),
    ...cssSpans.map((span) =>
      unit({
        projectId,
        source,
        unitKind: "code_symbol",
        locator: span.locator,
        startCharacter: span.startCharacter,
        endCharacter: span.endCharacter,
        startByte: cssCoordinates.get(span.startCharacter)!.byte,
        endByte: cssCoordinates.get(span.endCharacter)!.byte,
        startLine: cssCoordinates.get(span.startCharacter)!.line,
        endLine: cssCoordinates.get(span.endCharacter)!.line,
        title: span.title,
        adapter: CSS_SOURCE_UNIT_ADAPTER,
        versionBinding: "unit",
      }),
    ),
  ];
}

export async function scanRepositoryKnowledge(input: {
  repositoryRoot: string;
  projectId: string;
  policy: RepositoryKnowledgePolicy;
  generatedPaths?: ReadonlySet<string>;
  observeRevision?: ObserveGitRevision;
  supplementalSources?: readonly RepositorySupplementalSource[];
}): Promise<RepositoryKnowledgeScan> {
  const root = resolve(input.repositoryRoot);
  const sourceLineages = await loadDocumentMoveLineages({
    repositoryRoot: root,
    projectId: input.projectId,
  });
  const observeRevision = input.observeRevision ?? observeGitHeadRevision;
  const revisionBefore = await observeRevision(root);
  const sources: RepositorySource[] = [];
  let includedBytes = 0;
  let visitedFiles = 0;

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (isIgnorableFilesystemMetadata(entry)) continue;
      const absolute = resolve(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      const identityPath = sourceLineages.identityPathByCurrentPath.get(path);
      const identityFields = identityPath === undefined ? {} : { identityPath };
      const sourceId = stableId("src", { projectId: input.projectId, path: identityPath ?? path });
      if (path.startsWith("../") || path === "..") {
        throw new RepositoryKnowledgeError(
          "knowledge_source_unsafe",
          `${path} escapes the repository root.`,
        );
      }
      if (excluded(path, input.policy.exclude)) {
        if (entry.isFile() || entry.isSymbolicLink()) {
          sources.push({
            sourceId,
            path,
            ...identityFields,
            kind: repositorySourceKindForPath(path),
            ...agentArtifactFields(path),
            status: "excluded",
            classification: "ordinary",
            byteCount: 0,
            contentHash: null,
            reason: "policy_excluded",
          });
        }
        continue;
      }
      if (entry.isSymbolicLink()) {
        sources.push({
          sourceId,
          path,
          ...identityFields,
          kind: repositorySourceKindForPath(path),
          ...agentArtifactFields(path),
          status: "unsupported",
          classification: "unsupported",
          byteCount: 0,
          contentHash: null,
          reason: "symbolic_link",
        });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      visitedFiles += 1;
      if (visitedFiles > input.policy.limits.maxFiles) {
        throw new RepositoryKnowledgeError(
          "knowledge_source_limit_exceeded",
          "The repository file count exceeds the policy limit.",
        );
      }
      const stats = await lstat(absolute);
      const id = sourceId;
      if (input.generatedPaths?.has(path)) {
        continue;
      }
      if (secretCandidatePath(path)) {
        sources.push({
          sourceId: id,
          path,
          ...identityFields,
          kind: repositorySourceKindForPath(path),
          ...agentArtifactFields(path),
          status: "excluded",
          classification: "secret_candidate",
          byteCount: stats.size,
          contentHash: null,
          reason: "secret_candidate_bytes_not_read",
        });
        continue;
      }
      if (stats.size > input.policy.limits.maxFileBytes) {
        sources.push({
          sourceId: id,
          path,
          ...identityFields,
          kind: repositorySourceKindForPath(path),
          ...agentArtifactFields(path),
          status: "unsupported",
          classification: "unsupported",
          byteCount: stats.size,
          contentHash: null,
          reason: "file_size_limit",
        });
        continue;
      }
      const bytes = await safeReadFile(absolute, stats.size);
      const includeOpaqueSkillResource = (): boolean => {
        const opaqueFields = opaqueSkillResourceFields(path);
        if (!("agentArtifact" in opaqueFields)) return false;
        includedBytes += bytes.byteLength;
        if (includedBytes > input.policy.limits.maxTotalBytes) {
          throw new RepositoryKnowledgeError(
            "knowledge_source_limit_exceeded",
            "Read source bytes exceed the policy limit.",
          );
        }
        sources.push({
          sourceId: id,
          path,
          ...identityFields,
          kind: repositorySourceKindForPath(path),
          ...opaqueFields,
          status: "included",
          classification: "ordinary",
          byteCount: bytes.byteLength,
          contentHash: sha256(bytes),
          reason: "opaque_portable_skill_resource",
        });
        return true;
      };
      if (binaryExtensions.has(extname(path).toLowerCase())) {
        if (includeOpaqueSkillResource()) continue;
        sources.push({
          sourceId: id,
          path,
          ...identityFields,
          kind: "other",
          ...agentArtifactFields(path),
          status: "unsupported",
          classification: "unsupported",
          byteCount: stats.size,
          contentHash: null,
          reason: "binary_file",
        });
        continue;
      }
      if (bytes.includes(0)) {
        if (includeOpaqueSkillResource()) continue;
        sources.push({
          sourceId: id,
          path,
          ...identityFields,
          kind: "other",
          ...agentArtifactFields(path),
          status: "unsupported",
          classification: "unsupported",
          byteCount: bytes.byteLength,
          contentHash: null,
          reason: "binary_content",
        });
        continue;
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        if (includeOpaqueSkillResource()) continue;
        sources.push({
          sourceId: id,
          path,
          ...identityFields,
          kind: "other",
          ...agentArtifactFields(path),
          status: "unsupported",
          classification: "unsupported",
          byteCount: bytes.byteLength,
          contentHash: null,
          reason: "invalid_utf8",
        });
        continue;
      }
      if (generatedEntrypoint(path, content)) continue;
      includedBytes += bytes.byteLength;
      if (includedBytes > input.policy.limits.maxTotalBytes) {
        throw new RepositoryKnowledgeError(
          "knowledge_source_limit_exceeded",
          "Read source bytes exceed the policy limit.",
        );
      }
      sources.push({
        sourceId: id,
        path,
        ...identityFields,
        kind: repositorySourceKindForPath(path),
        ...agentArtifactFields(path),
        status: "included",
        classification: repositorySourceClassificationForPath(path),
        byteCount: bytes.byteLength,
        contentHash: sha256(bytes),
        content,
      });
    }
  };
  await walk(root);
  const revisionAfter = await observeRevision(root);
  if (JSON.stringify(revisionAfter) !== JSON.stringify(revisionBefore)) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The repository revision changed during the scan.",
    );
  }
  const revisionSourceId = stableId("src", {
    projectId: input.projectId,
    path: GIT_REVISION_SOURCE_PATH,
  });
  if (revisionBefore.status === "observed") {
    const revisionBytes = Buffer.byteLength(revisionBefore.content);
    includedBytes += revisionBytes;
    if (includedBytes > input.policy.limits.maxTotalBytes) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_limit_exceeded",
        "Read source bytes exceed the policy limit.",
      );
    }
    sources.push({
      sourceId: revisionSourceId,
      path: GIT_REVISION_SOURCE_PATH,
      kind: "revision_metadata",
      status: "included",
      classification: "ordinary",
      byteCount: revisionBytes,
      contentHash: sha256(revisionBefore.content),
      content: revisionBefore.content,
      origin: "git_revision_adapter",
    });
  } else {
    sources.push({
      sourceId: revisionSourceId,
      path: GIT_REVISION_SOURCE_PATH,
      kind: "revision_metadata",
      status: "unsupported",
      classification: "unsupported",
      byteCount: 0,
      contentHash: null,
      reason: revisionBefore.reason,
      origin: "git_revision_adapter",
    });
  }
  const supplementalByPath = new Map<string, RepositorySupplementalSource>();
  for (const supplemental of [...(input.supplementalSources ?? [])].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    if (
      !/^@(?:verification|event)\/[a-z][a-z0-9_]{2,150}$/u.test(supplemental.path) ||
      supplemental.content.includes("\0") ||
      !/^[a-z][a-z0-9._+-]{2,127}$/u.test(supplemental.adapter) ||
      supplemental.locator.length === 0 ||
      supplemental.locator.length > 300 ||
      supplemental.title.length === 0 ||
      supplemental.title.length > 300 ||
      supplementalByPath.has(supplemental.path) ||
      sources.some((source) => source.path === supplemental.path) ||
      (supplemental.kind === "verification_result" && supplemental.unitKind !== "verification") ||
      (supplemental.kind === "execution_event" && supplemental.unitKind !== "event")
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_evidence_source_invalid",
        "The supplemental evidence source contract is invalid.",
      );
    }
    visitedFiles += 1;
    if (visitedFiles > input.policy.limits.maxFiles) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_limit_exceeded",
        "The repository source count exceeds the policy limit.",
      );
    }
    const byteCount = Buffer.byteLength(supplemental.content);
    if (byteCount > input.policy.limits.maxFileBytes) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_limit_exceeded",
        "A supplemental evidence source exceeds the file byte limit.",
      );
    }
    includedBytes += byteCount;
    if (includedBytes > input.policy.limits.maxTotalBytes) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_limit_exceeded",
        "Read source bytes exceed the policy limit.",
      );
    }
    supplementalByPath.set(supplemental.path, supplemental);
    sources.push({
      sourceId: stableId("src", { projectId: input.projectId, path: supplemental.path }),
      path: supplemental.path,
      kind: supplemental.kind,
      status: "included",
      classification: supplemental.classification,
      byteCount,
      contentHash: sha256(supplemental.content),
      content: supplemental.content,
      origin: supplemental.origin,
    });
  }
  sources.sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "Document move lineage and the current source path conflict under the same source identity.",
    );
  }
  const included = sources.filter(
    (source): source is RepositorySource & { content: string; contentHash: string } =>
      source.status === "included" && source.content !== undefined && source.contentHash !== null,
  );
  const skillDescriptors = await extractSkillContractUnitDescriptors({
    repositoryRoot: root,
    sources: included,
  });
  const skillDescriptorByPath = new Map<string, typeof skillDescriptors>();
  for (const descriptor of skillDescriptors) {
    const values = skillDescriptorByPath.get(descriptor.path) ?? [];
    values.push(descriptor);
    skillDescriptorByPath.set(descriptor.path, values);
  }
  const units = included.flatMap((source) => {
    const supplemental = supplementalByPath.get(source.path);
    if (supplemental === undefined)
      return [
        ...extractUnits(input.projectId, source),
        ...(skillDescriptorByPath.get(source.path) ?? []).map((descriptor) =>
          unit({
            projectId: input.projectId,
            source,
            unitKind: "skill_contract",
            locator: descriptor.locator,
            startCharacter: 0,
            endCharacter: source.content.length,
            startByte: 0,
            endByte: source.byteCount,
            startLine: 1,
            endLine: source.content.split("\n").length,
            title: descriptor.title,
            adapter: SKILL_CONTRACT_SOURCE_UNIT_ADAPTER,
            versionBinding: "unit",
          }),
        ),
      ];
    return [
      unit({
        projectId: input.projectId,
        source,
        unitKind: supplemental.unitKind,
        locator: supplemental.locator,
        startCharacter: 0,
        endCharacter: source.content.length,
        startByte: 0,
        endByte: source.byteCount,
        startLine: 1,
        endLine: source.content.split("\n").length,
        title: supplemental.title,
        adapter: supplemental.adapter,
        versionBinding: "unit",
      }),
    ];
  });
  units.sort(
    (left, right) =>
      left.unitId.localeCompare(right.unitId) ||
      left.unitVersionId.localeCompare(right.unitVersionId),
  );
  for (const lineage of sourceLineages.records.filter((item) => item.activeTerminal)) {
    const source = included.find((item) => item.path === lineage.value.toPath);
    if (source?.contentHash !== lineage.value.sourceContentHash) continue;
    const sourceUnitIds = units
      .filter((item) => item.sourceId === source.sourceId)
      .map((item) => item.unitId)
      .sort();
    const bindingDigest = sha256(canonicalJson(sourceUnitIds));
    if (
      sourceUnitIds.length !== lineage.value.sourceUnitCount ||
      bindingDigest !== lineage.value.sourceUnitBindingDigest
    ) {
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        `The document move lineage ${lineage.value.lineageId} source-unit binding differs from the current exact moved bytes (${sourceUnitIds.length}/${lineage.value.sourceUnitCount}, ${bindingDigest}/${lineage.value.sourceUnitBindingDigest}).`,
      );
    }
  }
  const snapshotMaterials = sources.map(({ content: _content, ...source }) => source);
  const contentSnapshotMaterials = snapshotMaterials.filter(
    (source) =>
      source.kind !== "revision_metadata" &&
      source.kind !== "verification_result" &&
      source.kind !== "execution_event",
  );
  const contentUnitVersions = units
    .filter(
      (unit) =>
        unit.unitKind !== "revision" &&
        unit.unitKind !== "verification" &&
        unit.unitKind !== "event",
    )
    .map((unit) => unit.unitVersionId);
  return {
    schemaVersion: 1,
    projectId: input.projectId,
    policyId: input.policy.policyId,
    scannerBuild: "repository-scanner-v1",
    snapshotId: stableId("ksnap", {
      sources: snapshotMaterials,
      units: units.map((item) => item.unitVersionId),
    }),
    contentSnapshotId: stableId("ksnap", {
      sources: contentSnapshotMaterials,
      units: contentUnitVersions,
    }),
    coverage: {
      included: sources.filter((source) => source.status === "included").length,
      excluded: sources.filter((source) => source.status === "excluded").length,
      unsupported: sources.filter((source) => source.status === "unsupported").length,
      includedBytes,
      complete: true,
    },
    sources,
    units,
  };
}

export function serializableScan(scan: RepositoryKnowledgeScan): RepositoryKnowledgeScan {
  return {
    ...scan,
    sources: scan.sources.map(({ content: _content, ...source }) => source),
  };
}

export function relocateRepositoryKnowledgeScanSource(input: {
  scan: RepositoryKnowledgeScan;
  fromPath: string;
  toPath: string;
}): RepositoryKnowledgeScan {
  const source = input.scan.sources.find((item) => item.path === input.fromPath);
  if (
    source?.status !== "included" ||
    source.content === undefined ||
    source.contentHash === null ||
    input.scan.sources.some((item) => item.path === input.toPath)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The document move cannot be projected onto the current scan.",
    );
  }
  const identityPath = source.identityPath ?? source.path;
  const sources = input.scan.sources
    .map((item): RepositorySource =>
      item.sourceId === source.sourceId
        ? {
            sourceId: item.sourceId,
            path: input.toPath,
            identityPath,
            kind: repositorySourceKindForPath(input.toPath),
            ...agentArtifactFields(input.toPath),
            status: item.status,
            classification: repositorySourceClassificationForPath(input.toPath),
            byteCount: item.byteCount,
            contentHash: item.contentHash,
            ...(item.reason === undefined ? {} : { reason: item.reason }),
            ...(item.content === undefined ? {} : { content: item.content }),
            ...(item.origin === undefined ? {} : { origin: item.origin }),
          }
        : item,
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const units = input.scan.units
    .map((item) =>
      item.sourceId === source.sourceId
        ? {
            ...item,
            path: input.toPath,
            ...(item.unitKind === "file" ? { title: basename(input.toPath) } : {}),
          }
        : item,
    )
    .sort(
      (left, right) =>
        left.unitId.localeCompare(right.unitId) ||
        left.unitVersionId.localeCompare(right.unitVersionId),
    );
  const snapshotMaterials = sources.map(({ content: _content, ...item }) => item);
  const contentSnapshotMaterials = snapshotMaterials.filter(
    (item) =>
      item.kind !== "revision_metadata" &&
      item.kind !== "verification_result" &&
      item.kind !== "execution_event",
  );
  const contentUnitVersions = units
    .filter(
      (item) =>
        item.unitKind !== "revision" &&
        item.unitKind !== "verification" &&
        item.unitKind !== "event",
    )
    .map((item) => item.unitVersionId);
  return {
    ...input.scan,
    snapshotId: stableId("ksnap", {
      sources: snapshotMaterials,
      units: units.map((item) => item.unitVersionId),
    }),
    contentSnapshotId: stableId("ksnap", {
      sources: contentSnapshotMaterials,
      units: contentUnitVersions,
    }),
    sources,
    units,
  };
}

export function splitRepositoryKnowledgeScanSource(input: {
  scan: RepositoryKnowledgeScan;
  sourcePath: string;
  destinationPath: string;
  sourceContent: string;
  destinationContent: string;
}): RepositoryKnowledgeScan {
  const source = input.scan.sources.find((item) => item.path === input.sourcePath);
  if (
    source?.status !== "included" ||
    source.content === undefined ||
    source.contentHash === null ||
    input.scan.sources.some((item) => item.path === input.destinationPath) ||
    input.sourceContent.length === 0 ||
    input.destinationContent.length === 0
  )
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The document split cannot be projected onto the current scan.",
    );
  const updatedSource: RepositorySource & { content: string; contentHash: string } = {
    sourceId: source.sourceId,
    path: source.path,
    ...(source.identityPath === undefined ? {} : { identityPath: source.identityPath }),
    kind: source.kind,
    status: "included",
    classification: source.classification,
    byteCount: Buffer.byteLength(input.sourceContent),
    contentHash: sha256(input.sourceContent),
    content: input.sourceContent,
  };
  const destinationSource: RepositorySource & { content: string; contentHash: string } = {
    sourceId: stableId("src", { projectId: input.scan.projectId, path: input.destinationPath }),
    path: input.destinationPath,
    kind: repositorySourceKindForPath(input.destinationPath),
    ...agentArtifactFields(input.destinationPath),
    status: "included",
    classification: repositorySourceClassificationForPath(input.destinationPath),
    byteCount: Buffer.byteLength(input.destinationContent),
    contentHash: sha256(input.destinationContent),
    content: input.destinationContent,
  };
  const sources = [
    ...input.scan.sources.filter((item) => item.sourceId !== source.sourceId),
    updatedSource,
    destinationSource,
  ].sort((left, right) => left.path.localeCompare(right.path));
  const units = [
    ...input.scan.units.filter((item) => item.sourceId !== source.sourceId),
    ...extractUnits(input.scan.projectId, updatedSource),
    ...extractUnits(input.scan.projectId, destinationSource),
  ].sort(
    (left, right) =>
      left.unitId.localeCompare(right.unitId) ||
      left.unitVersionId.localeCompare(right.unitVersionId),
  );
  const snapshotMaterials = sources.map(({ content: _content, ...item }) => item);
  const contentSnapshotMaterials = snapshotMaterials.filter(
    (item) =>
      item.kind !== "revision_metadata" &&
      item.kind !== "verification_result" &&
      item.kind !== "execution_event",
  );
  const contentUnitVersions = units
    .filter(
      (item) =>
        item.unitKind !== "revision" &&
        item.unitKind !== "verification" &&
        item.unitKind !== "event",
    )
    .map((item) => item.unitVersionId);
  return {
    ...input.scan,
    snapshotId: stableId("ksnap", {
      sources: snapshotMaterials,
      units: units.map((item) => item.unitVersionId),
    }),
    contentSnapshotId: stableId("ksnap", {
      sources: contentSnapshotMaterials,
      units: contentUnitVersions,
    }),
    coverage: { ...input.scan.coverage, included: input.scan.coverage.included + 1 },
    sources,
    units,
  };
}

export function upsertRepositoryKnowledgeScanSource(input: {
  scan: RepositoryKnowledgeScan;
  path: string;
  content: string;
}): RepositoryKnowledgeScan {
  const existing = input.scan.sources.find((item) => item.path === input.path);
  if (
    existing !== undefined &&
    (existing.status !== "included" ||
      existing.content === undefined ||
      existing.contentHash === null)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The instruction bridge target cannot be projected safely onto the current scan.",
    );
  }
  const source: RepositorySource & { content: string; contentHash: string } = {
    sourceId:
      existing?.sourceId ?? stableId("src", { projectId: input.scan.projectId, path: input.path }),
    path: input.path,
    ...(existing?.identityPath === undefined ? {} : { identityPath: existing.identityPath }),
    kind: repositorySourceKindForPath(input.path),
    ...agentArtifactFields(input.path),
    status: "included",
    classification: repositorySourceClassificationForPath(input.path),
    byteCount: Buffer.byteLength(input.content),
    contentHash: sha256(input.content),
    content: input.content,
  };
  const sources = [...input.scan.sources.filter((item) => item.path !== input.path), source].sort(
    (left, right) => left.path.localeCompare(right.path),
  );
  const units = [
    ...input.scan.units.filter((item) => item.sourceId !== existing?.sourceId),
    ...extractUnits(input.scan.projectId, source),
  ].sort(
    (left, right) =>
      left.unitId.localeCompare(right.unitId) ||
      left.unitVersionId.localeCompare(right.unitVersionId),
  );
  const snapshotMaterials = sources.map(({ content: _content, ...item }) => item);
  const contentSnapshotMaterials = snapshotMaterials.filter(
    (item) =>
      item.kind !== "revision_metadata" &&
      item.kind !== "verification_result" &&
      item.kind !== "execution_event",
  );
  const contentUnitVersions = units
    .filter(
      (item) =>
        item.unitKind !== "revision" &&
        item.unitKind !== "verification" &&
        item.unitKind !== "event",
    )
    .map((item) => item.unitVersionId);
  return {
    ...input.scan,
    snapshotId: stableId("ksnap", {
      sources: snapshotMaterials,
      units: units.map((item) => item.unitVersionId),
    }),
    contentSnapshotId: stableId("ksnap", {
      sources: contentSnapshotMaterials,
      units: contentUnitVersions,
    }),
    coverage: {
      ...input.scan.coverage,
      included: input.scan.coverage.included + (existing === undefined ? 1 : 0),
      includedBytes:
        input.scan.coverage.includedBytes - (existing?.byteCount ?? 0) + source.byteCount,
    },
    sources,
    units,
  };
}

export function mergeRepositoryKnowledgeScanSources(input: {
  scan: RepositoryKnowledgeScan;
  sourcePath: string;
  destinationPath: string;
  destinationContent: string;
}): RepositoryKnowledgeScan {
  const source = input.scan.sources.find((item) => item.path === input.sourcePath);
  const destination = input.scan.sources.find((item) => item.path === input.destinationPath);
  if (
    source?.status !== "included" ||
    source.content === undefined ||
    source.contentHash === null ||
    destination?.status !== "included" ||
    destination.content === undefined ||
    destination.contentHash === null ||
    source.sourceId === destination.sourceId ||
    input.destinationContent.length === 0
  )
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The document merge cannot be projected onto the current scan.",
    );
  const updatedDestination: RepositorySource & { content: string; contentHash: string } = {
    sourceId: destination.sourceId,
    path: destination.path,
    ...(destination.identityPath === undefined ? {} : { identityPath: destination.identityPath }),
    kind: destination.kind,
    status: "included",
    classification: destination.classification,
    byteCount: Buffer.byteLength(input.destinationContent),
    contentHash: sha256(input.destinationContent),
    content: input.destinationContent,
  };
  const sources = [
    ...input.scan.sources.filter(
      (item) => item.sourceId !== source.sourceId && item.sourceId !== destination.sourceId,
    ),
    updatedDestination,
  ].sort((left, right) => left.path.localeCompare(right.path));
  const units = [
    ...input.scan.units.filter(
      (item) => item.sourceId !== source.sourceId && item.sourceId !== destination.sourceId,
    ),
    ...extractUnits(input.scan.projectId, updatedDestination),
  ].sort(
    (left, right) =>
      left.unitId.localeCompare(right.unitId) ||
      left.unitVersionId.localeCompare(right.unitVersionId),
  );
  const snapshotMaterials = sources.map(({ content: _content, ...item }) => item);
  const contentSnapshotMaterials = snapshotMaterials.filter(
    (item) =>
      item.kind !== "revision_metadata" &&
      item.kind !== "verification_result" &&
      item.kind !== "execution_event",
  );
  const contentUnitVersions = units
    .filter(
      (item) =>
        item.unitKind !== "revision" &&
        item.unitKind !== "verification" &&
        item.unitKind !== "event",
    )
    .map((item) => item.unitVersionId);
  return {
    ...input.scan,
    snapshotId: stableId("ksnap", {
      sources: snapshotMaterials,
      units: units.map((item) => item.unitVersionId),
    }),
    contentSnapshotId: stableId("ksnap", {
      sources: contentSnapshotMaterials,
      units: contentUnitVersions,
    }),
    coverage: { ...input.scan.coverage, included: input.scan.coverage.included - 1 },
    sources,
    units,
  };
}

export function scanDigest(scan: RepositoryKnowledgeScan): string {
  return sha256(canonicalJson(serializableScan(scan)));
}
