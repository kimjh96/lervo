import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { listKnowledgeArtifactPaths } from "./artifact-paths.js";
import { stableId } from "./integrity.js";
import { loadStoredClaims, loadStoredRelations, type StoredClaim, type StoredRelation } from "./store-reader.js";
import type {
  KnowledgeFreshness,
  KnowledgeImpactItem,
  KnowledgeImpactReason,
  KnowledgeImpactReport,
  RepositoryKnowledgeScan,
} from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

const MAX_HISTORY_FILES = 256;
const MAX_HISTORY_FILE_BYTES = 16 * 1024 * 1024;
const MAX_HISTORY_TOTAL_BYTES = 128 * 1024 * 1024;

interface EvidenceSubject {
  subjectKind: "claim" | "relation";
  subjectId: string;
  conceptIds: string[];
  evidenceUnitVersionIds: string[];
  evidenceUnitIds?: string[];
}

interface LineageProjection {
  versionToUnitId: Map<string, string>;
  complete: boolean;
}

async function loadHistoricalLineage(root: string): Promise<LineageProjection> {
  let files: string[];
  try {
    files = await listKnowledgeArtifactPaths({ root, directory: ".lervo/state/knowledge/source-units", extension: "json", maximumFiles: MAX_HISTORY_FILES });
  } catch (error) {
    return { versionToUnitId: new Map(), complete: false };
  }

  const versionToUnitId = new Map<string, string>();
  const ambiguous = new Set<string>();
  let totalBytes = 0;
  let complete = true;
  for (const file of files) {
    try {
      const handle = await open(resolve(root, file), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      let bytes: Buffer;
      try {
        const stats = await handle.stat();
        if (!stats.isFile() || stats.size > MAX_HISTORY_FILE_BYTES) throw new Error();
        bytes = await handle.readFile();
      } finally { await handle.close(); }
      totalBytes += bytes.byteLength;
      if (bytes.byteLength > MAX_HISTORY_FILE_BYTES || totalBytes > MAX_HISTORY_TOTAL_BYTES) {
        return { versionToUnitId: new Map(), complete: false };
      }
      const value = JSON.parse(bytes.toString("utf8")) as { schemaVersion?: unknown; units?: unknown };
      if (value.schemaVersion !== 1 || !Array.isArray(value.units)) throw new Error();
      for (const item of value.units) {
        const unit = item as { unitId?: unknown; unitVersionId?: unknown };
        if (typeof unit.unitId !== "string" || typeof unit.unitVersionId !== "string") throw new Error();
        const previous = versionToUnitId.get(unit.unitVersionId);
        if (previous !== undefined && previous !== unit.unitId) ambiguous.add(unit.unitVersionId);
        else versionToUnitId.set(unit.unitVersionId, unit.unitId);
      }
    } catch {
      complete = false;
    }
  }
  for (const versionId of ambiguous) versionToUnitId.delete(versionId);
  return { versionToUnitId, complete: complete && ambiguous.size === 0 };
}

function aggregateFreshness(counts: KnowledgeImpactItem["evidence"]): KnowledgeFreshness {
  if (counts.stale > 0) return "stale";
  if (counts.unknown > 0) return "unknown";
  return "current";
}

function evaluateSubject(input: {
  subject: EvidenceSubject;
  currentVersionIds: Set<string>;
  currentByUnitId: Map<string, string>;
  versionToUnitId: Map<string, string>;
}): KnowledgeImpactItem {
  const evidence = { current: 0, stale: 0, unknown: 0 };
  const reasons = new Set<KnowledgeImpactReason>();
  input.subject.evidenceUnitVersionIds.forEach((versionId, index) => {
    if (input.currentVersionIds.has(versionId)) {
      evidence.current += 1;
      return;
    }
    const unitId = input.subject.evidenceUnitIds?.[index] ?? input.versionToUnitId.get(versionId);
    if (unitId === undefined) {
      evidence.unknown += 1;
      reasons.add("lineage_unavailable");
    } else if (input.currentByUnitId.has(unitId)) {
      evidence.stale += 1;
      reasons.add("source_unit_changed");
    } else {
      evidence.stale += 1;
      reasons.add("source_unit_missing");
    }
  });
  return {
    subjectKind: input.subject.subjectKind,
    subjectId: input.subject.subjectId,
    freshness: aggregateFreshness(evidence),
    evidence,
    reasons: [...reasons].sort(),
  };
}

function subjectForClaim(claim: StoredClaim): EvidenceSubject {
  return {
    subjectKind: "claim",
    subjectId: claim.claimId,
    conceptIds: [claim.conceptId],
    evidenceUnitVersionIds: claim.evidenceUnitVersionIds,
    ...(claim.evidenceUnitIds === undefined ? {} : { evidenceUnitIds: claim.evidenceUnitIds }),
  };
}

function subjectForRelation(relation: StoredRelation): EvidenceSubject {
  return {
    subjectKind: "relation",
    subjectId: relation.relationId,
    conceptIds: [relation.from.id, relation.to.id],
    evidenceUnitVersionIds: relation.evidenceUnitVersionIds,
    ...(relation.evidenceUnitIds === undefined ? {} : { evidenceUnitIds: relation.evidenceUnitIds }),
  };
}

export async function analyzeRepositoryKnowledgeImpact(input: {
  repositoryRoot: string;
  scan: RepositoryKnowledgeScan;
}): Promise<KnowledgeImpactReport> {
  const root = resolve(input.repositoryRoot);
  const [storedClaims, storedRelations] = await Promise.all([
    loadStoredClaims(root),
    loadStoredRelations(root),
  ]);
  const invalid = [...storedClaims, ...storedRelations].find((item) => item.value === null);
  if (invalid !== undefined) {
    throw new RepositoryKnowledgeError("knowledge_impact_invalid", `Impact cannot be calculated for sidecar: ${invalid.file}`);
  }

  const subjects: EvidenceSubject[] = [
    ...storedClaims.flatMap((item) => item.value === null ? [] : [subjectForClaim(item.value)]),
    ...storedRelations.flatMap((item) => item.value === null ? [] : [subjectForRelation(item.value)]),
  ];
  const currentVersionIds = new Set(input.scan.units.map((unit) => unit.unitVersionId));
  const currentByUnitId = new Map(input.scan.units.map((unit) => [unit.unitId, unit.unitVersionId]));
  const needsHistory = subjects.some((subject) => subject.evidenceUnitVersionIds.some((versionId, index) =>
    !currentVersionIds.has(versionId) && subject.evidenceUnitIds?.[index] === undefined));
  const history = needsHistory ? await loadHistoricalLineage(root) : { versionToUnitId: new Map<string, string>(), complete: true };
  const versionToUnitId = new Map(history.versionToUnitId);
  for (const unit of input.scan.units) versionToUnitId.set(unit.unitVersionId, unit.unitId);

  const semanticItems = subjects.map((subject) => ({
    subject,
    item: evaluateSubject({ subject, currentVersionIds, currentByUnitId, versionToUnitId }),
  }));
  const conceptMembers = new Map<string, KnowledgeImpactItem[]>();
  for (const { subject, item } of semanticItems) {
    for (const conceptId of subject.conceptIds) {
      const members = conceptMembers.get(conceptId) ?? [];
      members.push(item);
      conceptMembers.set(conceptId, members);
    }
  }
  const conceptItems: KnowledgeImpactItem[] = [...conceptMembers.entries()].map(([conceptId, members]) => {
    const evidence = members.reduce((sum, item) => ({
      current: sum.current + item.evidence.current,
      stale: sum.stale + item.evidence.stale,
      unknown: sum.unknown + item.evidence.unknown,
    }), { current: 0, stale: 0, unknown: 0 });
    return {
      subjectKind: "concept",
      subjectId: conceptId,
      freshness: aggregateFreshness(evidence),
      evidence,
      reasons: [...new Set(members.flatMap((item) => item.reasons))].sort(),
    };
  });
  const items = [...semanticItems.map(({ item }) => item), ...conceptItems]
    .sort((left, right) => left.subjectKind.localeCompare(right.subjectKind) || left.subjectId.localeCompare(right.subjectId));
  const summary = {
    current: items.filter((item) => item.freshness === "current").length,
    stale: items.filter((item) => item.freshness === "stale").length,
    unknown: items.filter((item) => item.freshness === "unknown").length,
    affectedConcepts: conceptItems.filter((item) => item.freshness === "stale").length,
  };
  const lineageComplete = !items.some((item) => item.reasons.includes("lineage_unavailable"));
  const materials = {
    projectId: input.scan.projectId,
    sourceSnapshotId: input.scan.snapshotId,
    status: summary.stale > 0 ? "affected" as const : summary.unknown > 0 ? "unknown" as const : "current" as const,
    lineageComplete,
    summary,
    items,
  };
  return { schemaVersion: 1, reportId: stableId("kimpact", materials), ...materials };
}
