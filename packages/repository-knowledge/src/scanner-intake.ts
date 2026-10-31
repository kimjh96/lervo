import { lstat, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import {
  agentArtifactFields,
  binaryExtensions,
  repositorySourceKindForPath,
  secretCandidatePath,
} from "./repository-source-classification.js";
import { isIgnorableFilesystemMetadata, isNestedGitWorkingTree } from "./filesystem-metadata.js";
import { compileKnowledgeScannerExclusion } from "./knowledge-intake-policy.js";
import { sha256, stableId } from "./integrity.js";
import { loadDocumentMoveLineages } from "./source-lineage.js";
import type {
  RepositoryKnowledgePolicy,
  RepositoryKnowledgeScan,
  RepositorySource,
  RepositorySupplementalSource,
} from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";
import {
  GIT_REVISION_SOURCE_PATH,
  observeGitHeadRevision,
  type ObserveGitRevision,
} from "./git-revision-source.js";
import { repositoryAgentArtifactForPath } from "./agent-artifact-profile.js";
import { observeGitIgnoredPaths, type ObserveGitIgnoredPaths } from "./git-ignored-paths.js";
import { defaultDecisionTaxonomy } from "@lervo/project";
import { loadDocumentLayoutContract } from "./document-layout-contract.js";
import { compareScanPaths, repositoryScanPriority, scanPriorityClasses } from "./scan-priority.js";
import type { SourceUnitCache } from "./source-unit-cache.js";

import { concurrentSourceChange, readRepositoryFileSource } from "./scanner-file-source.js";

export interface RepositoryKnowledgeScanInput {
  repositoryRoot: string;
  projectId: string;
  policy: RepositoryKnowledgePolicy;
  generatedPaths?: ReadonlySet<string>;
  observeRevision?: ObserveGitRevision;
  observeIgnoredPaths?: ObserveGitIgnoredPaths;
  supplementalSources?: readonly RepositorySupplementalSource[];
  sourceUnitFailureMode?: "fail" | "file_only";
  sourceUnitCache?: SourceUnitCache;
}

export async function readRepositoryKnowledgeSources(input: RepositoryKnowledgeScanInput) {
  const root = resolve(input.repositoryRoot);
  const sourceLineages = await loadDocumentMoveLineages({
    repositoryRoot: root,
    projectId: input.projectId,
  });
  const observeRevision = input.observeRevision ?? observeGitHeadRevision;
  const revisionBefore = await observeRevision(root);
  const sources: RepositorySource[] = [];
  const excludes = compileKnowledgeScannerExclusion(input.policy);
  // Git-ignored untracked paths carry no repository knowledge (ADR-0433), so the scan never reads
  // them. Without this, a virtual environment or build output fills the read budget.
  const gitIgnored = await (input.observeIgnoredPaths ?? observeGitIgnoredPaths)(root);
  let includedBytes = 0;
  const taxonomy = (await loadDocumentLayoutContract(root)).taxonomy ?? defaultDecisionTaxonomy;
  const candidates: Array<{
    path: string;
    byteCount: number;
    source: RepositorySource;
    read: () => Promise<void>;
  }> = [];
  const supplementalByPath = new Map<string, RepositorySupplementalSource>();
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
      if (excludes(path)) {
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
      if (gitIgnored.ignores(path, entry.isDirectory())) continue;
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
        if (!(await isNestedGitWorkingTree(absolute))) await walk(absolute);
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
      const stats = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
        throw error.code === "ENOENT" ? concurrentSourceChange(path) : error;
      });
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
      const artifactProfile = repositoryAgentArtifactForPath(path);
      const boundedOpaqueResource = artifactProfile?.contentHandling === "opaque_resource";
      if (stats.size > input.policy.limits.maxFileBytes && !boundedOpaqueResource) {
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
      const source: RepositorySource = {
        sourceId: id,
        path,
        ...identityFields,
        kind: repositorySourceKindForPath(path),
        ...agentArtifactFields(path),
        status: "unsupported",
        classification: "unsupported",
        byteCount: stats.size,
        contentHash: null,
        reason: "total_budget_exceeded",
      };
      if (binaryExtensions.has(extname(path).toLowerCase()) && !boundedOpaqueResource) {
        sources.push({ ...source, kind: "other", reason: "binary_file" });
        continue;
      }
      candidates.push({
        path,
        byteCount: stats.size,
        source,
        read: async () => {
          const observed = await readRepositoryFileSource(absolute, source);
          if (observed !== null) sources.push(observed);
        },
      });
    }
  };
  await walk(root);
  const revisionSourceId = stableId("src", {
    projectId: input.projectId,
    path: GIT_REVISION_SOURCE_PATH,
  });
  if (revisionBefore.status === "observed") {
    const revisionBytes = Buffer.byteLength(revisionBefore.content);
    const source: RepositorySource = {
      sourceId: revisionSourceId,
      path: GIT_REVISION_SOURCE_PATH,
      kind: "revision_metadata",
      status: "included",
      classification: "ordinary",
      byteCount: revisionBytes,
      contentHash: sha256(revisionBefore.content),
      content: revisionBefore.content,
      origin: "git_revision_adapter",
    };
    candidates.push({
      path: source.path,
      byteCount: revisionBytes,
      source,
      read: async () => {
        sources.push(source);
      },
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
  // A set keeps the collision check linear; event-heavy repositories supply thousands of units.
  const repositorySourcePaths = new Set(
    [...sources, ...candidates.map((candidate) => candidate.source)].map((source) => source.path),
  );
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
      repositorySourcePaths.has(supplemental.path) ||
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
    supplementalByPath.set(supplemental.path, supplemental);
    const source: RepositorySource = {
      sourceId: stableId("src", { projectId: input.projectId, path: supplemental.path }),
      path: supplemental.path,
      kind: supplemental.kind,
      status: "included",
      classification: supplemental.classification,
      byteCount,
      contentHash: sha256(supplemental.content),
      content: supplemental.content,
      origin: supplemental.origin,
    };
    candidates.push({
      path: source.path,
      byteCount,
      source,
      read: async () => {
        sources.push(source);
      },
    });
  }
  candidates.sort(
    (left, right) =>
      scanPriorityClasses.indexOf(repositoryScanPriority(left.path, taxonomy)) -
        scanPriorityClasses.indexOf(repositoryScanPriority(right.path, taxonomy)) ||
      compareScanPaths(left.path, right.path),
  );
  const skippedForBudget: RepositoryKnowledgeScan["skippedForBudget"] = {
    count: 0,
    bytes: 0,
    classes: [],
  };
  const skippedClasses = new Set<RepositoryKnowledgeScan["skippedForBudget"]["classes"][number]>();
  for (const candidate of candidates) {
    if (includedBytes + candidate.byteCount > input.policy.limits.maxTotalBytes) {
      const { content: _content, ...metadata } = candidate.source;
      sources.push({
        ...metadata,
        status: "unsupported",
        classification: "unsupported",
        contentHash: null,
        reason: "total_budget_exceeded",
      });
      skippedForBudget.count += 1;
      skippedForBudget.bytes += candidate.byteCount;
      skippedClasses.add(repositoryScanPriority(candidate.path, taxonomy));
      continue;
    }
    const offset = sources.length;
    await candidate.read();
    for (const source of sources.slice(offset))
      if (source.status === "included") includedBytes += source.byteCount;
  }
  if (JSON.stringify(await observeRevision(root)) !== JSON.stringify(revisionBefore))
    throw new RepositoryKnowledgeError(
      "source_bytes_changed",
      "The repository revision changed during the scan.",
    );
  skippedForBudget.classes = scanPriorityClasses.filter((value) => skippedClasses.has(value));
  return { sources, includedBytes, supplementalByPath, sourceLineages, skippedForBudget };
}
