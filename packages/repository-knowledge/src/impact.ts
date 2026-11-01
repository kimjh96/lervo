import { resolve } from "node:path";

import { stableId } from "./integrity.js";
import {
  loadStoredClaims,
  loadStoredRelations,
  type StoredClaim,
  type StoredRelation,
} from "./store-reader.js";
import type {
  KnowledgeFreshness,
  KnowledgeImpactItem,
  KnowledgeImpactReason,
  KnowledgeImpactReport,
  RepositoryKnowledgeScan,
} from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";
import { observedOnlySource } from "./scan-retention.js";

interface EvidenceSubject {
  subjectKind: "claim" | "relation";
  subjectId: string;
  conceptIds: string[];
  evidenceUnitVersionIds: string[];
  evidenceUnitIds?: string[];
}

function aggregateFreshness(counts: KnowledgeImpactItem["evidence"]): KnowledgeFreshness {
  if (counts.stale > 0) return "stale";
  if (counts.unknown > 0) return "unknown";
  return "current";
}

function evaluateSubject(input: {
  /** Every unit of every source is present, so an absent unit is provably missing. */
  complete: boolean;
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
      if (!input.complete) reasons.add("scan_incomplete");
    } else if (input.currentByUnitId.has(unitId)) {
      evidence.stale += 1;
      reasons.add("source_unit_changed");
    } else if (!input.complete) {
      evidence.unknown += 1;
      reasons.add("scan_incomplete");
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
    ...(relation.evidenceUnitIds === undefined
      ? {}
      : { evidenceUnitIds: relation.evidenceUnitIds }),
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
    throw new RepositoryKnowledgeError(
      "knowledge_impact_invalid",
      `Impact cannot be calculated for sidecar: ${invalid.file}`,
    );
  }

  const subjects: EvidenceSubject[] = [
    ...storedClaims.flatMap((item) => (item.value === null ? [] : [subjectForClaim(item.value)])),
    ...storedRelations.flatMap((item) =>
      item.value === null ? [] : [subjectForRelation(item.value)],
    ),
  ];
  const currentVersionIds = new Set(input.scan.units.map((unit) => unit.unitVersionId));
  const currentByUnitId = new Map(
    input.scan.units.map((unit) => [unit.unitId, unit.unitVersionId]),
  );
  // Historical source-unit snapshots are deliberately not retained. New semantic
  // records carry stable unit IDs; legacy version-only evidence becomes unknown
  // after state cleanup instead of making a rebuildable cache canonical.
  const versionToUnitId = new Map<string, string>();
  for (const unit of input.scan.units) versionToUnitId.set(unit.unitVersionId, unit.unitId);

  // Unit ids are one-way digests, so an absent cited unit cannot be attributed to a source. Any
  // observed-only source (ADR-0544) may own it, so absence proves deletion only when every source
  // is retained; otherwise it is unknown with `scan_incomplete`, never stale.
  const unitsComplete =
    input.scan.coverage === "complete" && !input.scan.sources.some(observedOnlySource);
  const semanticItems = subjects.map((subject) => ({
    subject,
    item: evaluateSubject({
      complete: unitsComplete,
      subject,
      currentVersionIds,
      currentByUnitId,
      versionToUnitId,
    }),
  }));
  const conceptMembers = new Map<string, KnowledgeImpactItem[]>();
  for (const { subject, item } of semanticItems) {
    for (const conceptId of subject.conceptIds) {
      const members = conceptMembers.get(conceptId) ?? [];
      members.push(item);
      conceptMembers.set(conceptId, members);
    }
  }
  const conceptItems: KnowledgeImpactItem[] = [...conceptMembers.entries()].map(
    ([conceptId, members]) => {
      const evidence = members.reduce(
        (sum, item) => ({
          current: sum.current + item.evidence.current,
          stale: sum.stale + item.evidence.stale,
          unknown: sum.unknown + item.evidence.unknown,
        }),
        { current: 0, stale: 0, unknown: 0 },
      );
      return {
        subjectKind: "concept",
        subjectId: conceptId,
        freshness: aggregateFreshness(evidence),
        evidence,
        reasons: [...new Set(members.flatMap((item) => item.reasons))].sort(),
      };
    },
  );
  const items = [...semanticItems.map(({ item }) => item), ...conceptItems].sort(
    (left, right) =>
      left.subjectKind.localeCompare(right.subjectKind) ||
      left.subjectId.localeCompare(right.subjectId),
  );
  const summary = {
    current: items.filter((item) => item.freshness === "current").length,
    stale: items.filter((item) => item.freshness === "stale").length,
    unknown: items.filter((item) => item.freshness === "unknown").length,
    affectedConcepts: conceptItems.filter((item) => item.freshness === "stale").length,
  };
  const lineageComplete = !items.some((item) => item.reasons.includes("lineage_unavailable"));
  const materials = {
    coverage: input.scan.coverage,
    skippedForBudget: input.scan.skippedForBudget,
    projectId: input.scan.projectId,
    sourceSnapshotId: input.scan.snapshotId,
    status:
      summary.stale > 0
        ? ("affected" as const)
        : summary.unknown > 0 || input.scan.coverage !== "complete"
          ? ("unknown" as const)
          : ("current" as const),
    lineageComplete,
    summary,
    items,
  };
  return { schemaVersion: 1, reportId: stableId("kimpact", materials), ...materials };
}
