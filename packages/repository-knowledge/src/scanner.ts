import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import {
  agentArtifactFields,
  binaryExtensions,
  generatedEntrypoint,
  opaqueSkillResourceFields,
  repositorySourceClassificationForPath,
  repositorySourceKindForPath,
  secretCandidatePath,
} from "./repository-source-classification.js";
import { extractUnits, unit } from "./repository-source-units.js";
import { isIgnorableFilesystemMetadata, isNestedGitWorkingTree } from "./filesystem-metadata.js";
import { compileKnowledgeScannerExclusion } from "./knowledge-intake-policy.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { loadDocumentMoveLineages } from "./source-lineage.js";
import type {
  RepositoryKnowledgePolicy,
  RepositoryKnowledgeScan,
  RepositorySource,
  RepositorySupplementalSource,
} from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";
import {
  extractSkillContractUnitDescriptors,
  SKILL_CONTRACT_SOURCE_UNIT_ADAPTER,
} from "./skill-contract-source-units.js";
import {
  GIT_REVISION_SOURCE_PATH,
  observeGitHeadRevision,
  type ObserveGitRevision,
} from "./git-revision-source.js";
import { repositoryAgentArtifactForPath } from "./agent-artifact-profile.js";
import type { SourceUnitCache } from "./source-unit-cache.js";

/** A source that moves under the scan is a concurrent edit, not an unsafe source. */
function concurrentSourceChange(path: string): RepositoryKnowledgeError {
  return new RepositoryKnowledgeError("source_bytes_changed", `${path} changed during the scan.`);
}

async function safeReadFile(
  absolute: string,
  path: string,
  expectedSize: number,
): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size !== expectedSize) throw concurrentSourceChange(path);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw concurrentSourceChange(path);
    return bytes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw concurrentSourceChange(path);
    throw error;
  } finally {
    await handle?.close();
  }
}

interface RepositoryKnowledgeScanInput {
  repositoryRoot: string;
  projectId: string;
  policy: RepositoryKnowledgePolicy;
  generatedPaths?: ReadonlySet<string>;
  observeRevision?: ObserveGitRevision;
  supplementalSources?: readonly RepositorySupplementalSource[];
  sourceUnitFailureMode?: "fail" | "file_only";
  sourceUnitCache?: SourceUnitCache;
}

/** Attempts per scan when another writer moves the revision or a file under it. */
const REPOSITORY_KNOWLEDGE_SCAN_ATTEMPTS = 3;

/**
 * A scan only reads, so one that saw a concurrent commit, replica pull, or edit is repeated
 * against the new state. A repository that keeps moving still fails with `source_bytes_changed`.
 */
export async function scanRepositoryKnowledge(
  input: RepositoryKnowledgeScanInput,
): Promise<RepositoryKnowledgeScan> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await scanRepositoryKnowledgeOnce(input);
    } catch (error) {
      if (
        attempt >= REPOSITORY_KNOWLEDGE_SCAN_ATTEMPTS ||
        !(error instanceof RepositoryKnowledgeError) ||
        error.code !== "source_bytes_changed"
      )
        throw error;
    }
  }
}

async function scanRepositoryKnowledgeOnce(
  input: RepositoryKnowledgeScanInput,
): Promise<RepositoryKnowledgeScan> {
  const root = resolve(input.repositoryRoot);
  const extractSourceUnits =
    input.sourceUnitCache?.begin(input) ??
    ((source: RepositorySource & { content: string; contentHash: string }) =>
      extractUnits(input.projectId, source, input.sourceUnitFailureMode));
  const sourceLineages = await loadDocumentMoveLineages({
    repositoryRoot: root,
    projectId: input.projectId,
  });
  const observeRevision = input.observeRevision ?? observeGitHeadRevision;
  const revisionBefore = await observeRevision(root);
  const sources: RepositorySource[] = [];
  const excludes = compileKnowledgeScannerExclusion(input.policy);
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
      const bytes = await safeReadFile(absolute, path, stats.size);
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
      "source_bytes_changed",
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
  // A set keeps the collision check linear; event-heavy repositories supply thousands of units.
  const repositorySourcePaths = new Set(sources.map((source) => source.path));
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
        ...extractSourceUnits(source),
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

export {
  repositorySourceKindForPath,
  repositorySourceClassificationForPath,
  repositoryPathCanRemainIncluded,
} from "./repository-source-classification.js";
export {
  serializableScan,
  scanDigest,
  relocateRepositoryKnowledgeScanSource,
  splitRepositoryKnowledgeScanSource,
  upsertRepositoryKnowledgeScanSource,
  mergeRepositoryKnowledgeScanSources,
} from "./scan-transforms.js";
