import { basename } from "node:path";

import { canonicalJson, sha256, stableId } from "./integrity.js";
import {
  agentArtifactFields,
  repositorySourceKindForPath,
  repositorySourceClassificationForPath,
} from "./repository-source-classification.js";
import { extractUnits } from "./repository-source-units.js";
import type { RepositoryKnowledgeScan, RepositorySource } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

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
