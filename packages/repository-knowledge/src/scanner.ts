import { canonicalJson, sha256, stableId } from "./integrity.js";
import { extractUnits, supplementalEvidenceUnit, unit } from "./repository-source-units.js";
import { observedOnlySource } from "./scan-retention.js";
import {
  extractSkillContractUnitDescriptors,
  SKILL_CONTRACT_SOURCE_UNIT_ADAPTER,
} from "./skill-contract-source-units.js";
import {
  readRepositoryKnowledgeSources,
  type RepositoryKnowledgeScanInput,
} from "./scanner-intake.js";
import {
  RepositoryKnowledgeError,
  type RepositoryKnowledgeScan,
  type RepositorySource,
} from "./types.js";

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
  const {
    sources,
    observedUnits,
    supplementalByPath,
    sourceLineages,
    coverage,
    skippedForBudget,
    retention,
  } = await readRepositoryKnowledgeSources(input);
  const root = input.repositoryRoot;
  const extractSourceUnits =
    input.sourceUnitCache?.begin(input) ??
    ((source: RepositorySource & { content: string; contentHash: string }) =>
      extractUnits(input.projectId, source, input.sourceUnitFailureMode));
  sources.sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "Document move lineage and the current source path conflict under the same source identity.",
    );
  }
  // Observed-only sources never reach the source-unit cache: it maps exact retained bytes to their
  // complete extraction, so its entries never cross between retained and observed-only reads.
  const included = sources.filter(
    (source): source is RepositorySource & { content: string; contentHash: string } =>
      source.status === "included" && source.content !== undefined && source.contentHash !== null,
  );
  const skillDescriptors = await extractSkillContractUnitDescriptors({
    repositoryRoot: root,
    sources: included,
    budgetSkippedPaths: sources.filter(observedOnlySource).map((source) => source.path),
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
    return [supplementalEvidenceUnit(input.projectId, source, supplemental)];
  });
  units.push(...observedUnits);
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
    coverage,
    skippedForBudget,
    retention,
    inventoryCoverage: {
      included: sources.filter((source) => source.status === "included").length,
      excluded: sources.filter((source) => source.status === "excluded").length,
      unsupported: sources.filter((source) => source.status === "unsupported").length,
      includedBytes: sources
        .filter((source) => source.status === "included")
        .reduce((total, source) => total + source.byteCount, 0),
      complete: coverage === "complete",
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
