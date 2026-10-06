import type { DecisionTaxonomy } from "@lervo/project";

import { classifyFlatDecision, type DecisionLayoutBlockerCode } from "./decision-layout.js";
import {
  classifyClaudeRule,
  classifyRepositoryDocument,
  type DocumentLayoutBlockerCode,
  type DocumentRolePlacement,
} from "./document-layout.js";
import type {
  DeferredDocumentRoute,
  DocumentRouteBasis,
  DocumentRouteEvidence,
  RetainedDocumentPlacement,
  SemanticRouteEvidence,
} from "./document-route-resolution.js";
import type { RepositorySource } from "./types.js";

export type RepositoryLayoutClassification =
  | "product"
  | "architecture"
  | "specification"
  | "roadmap"
  | "decision"
  | "document"
  | "instruction"
  | "skill";

export type RepositoryLayoutReason =
  | "recognized_root_document_role"
  | "recognized_decision_document"
  | "classified_repository_document"
  | "normalized_provider_instruction"
  | "normalized_portable_skill";

export type IncludedRepositorySource = RepositorySource & { content: string; contentHash: string };

export interface RepositoryLayoutCandidate {
  source: IncludedRepositorySource;
  toPath: string;
  classification: RepositoryLayoutClassification;
  reason: RepositoryLayoutReason;
  group?: string;
  subgroup?: string;
  routeId?: string;
  classificationBasis?: DocumentRouteBasis;
  semanticClassification?: SemanticRouteEvidence;
  instructionPaths?: string[];
}

export type RepositoryLayoutSourceOutcome =
  | { kind: "candidate"; candidate: RepositoryLayoutCandidate }
  | {
      kind: "blocked";
      blocker: {
        code: DecisionLayoutBlockerCode | DocumentLayoutBlockerCode;
        path: string;
        candidateRouteIds?: string[];
      };
    }
  | { kind: "deferred"; deferral: DeferredDocumentRoute }
  | { kind: "retained"; retained: RetainedDocumentPlacement }
  | { kind: "none" };

export function includedRepositorySource(
  source: RepositorySource,
): IncludedRepositorySource | null {
  return source.status === "included" && source.contentHash !== null && source.content !== undefined
    ? (source as IncludedRepositorySource)
    : null;
}

/** Layout classification of each built-in document role; other roles are plain documents. */
const ROLE_CLASSIFICATIONS: Readonly<Record<string, RepositoryLayoutClassification>> = {
  product_vision: "product",
  system_architecture: "architecture",
  execution_specification: "specification",
  delivery_roadmap: "roadmap",
};

/**
 * A semantic role whose destination already exists cannot move without displacing a document,
 * so it waits for an owner decision instead of blocking the plan. Declared roles keep the
 * existing `destination_exists` blocker, because the owner asked for that exact move.
 */
function placedRole(
  source: IncludedRepositorySource,
  placement: DocumentRolePlacement,
  existingPaths: ReadonlySet<string>,
): RepositoryLayoutSourceOutcome {
  if (placement.semanticClassification !== undefined && existingPaths.has(placement.toPath))
    return {
      kind: "deferred",
      deferral: {
        classificationId: placement.semanticClassification.classificationId,
        subject: "document",
        path: source.path,
        contentHash: source.contentHash,
        reason: "semantic_classification_uncertain",
      },
    };
  return {
    kind: "candidate",
    candidate: {
      source,
      toPath: placement.toPath,
      classification: ROLE_CLASSIFICATIONS[placement.roleId] ?? "document",
      reason: "recognized_root_document_role",
      classificationBasis: placement.classificationBasis,
      ...(placement.semanticClassification === undefined
        ? {}
        : { semanticClassification: placement.semanticClassification }),
    },
  };
}

/**
 * Classifies one scanned source from its bytes and the supplied evidence alone: provider skills
 * and rules, flat decisions, then legacy repository documents, which may fill a document role.
 */
export function classifyRepositoryLayoutSource(
  source: IncludedRepositorySource,
  taxonomy: DecisionTaxonomy,
  evidence: DocumentRouteEvidence,
  existingPaths: ReadonlySet<string>,
): RepositoryLayoutSourceOutcome {
  const claudeSkill = /^(?:.*\/)?\.claude\/skills\/([^/]+)\/(.+)$/u.exec(source.path);
  if (claudeSkill !== null)
    return {
      kind: "candidate",
      candidate: {
        source,
        toPath: `.agents/skills/${claudeSkill[1]}/${claudeSkill[2]}`,
        classification: "skill",
        reason: "normalized_portable_skill",
      },
    };
  const instruction = classifyClaudeRule(source.path, source.content, taxonomy, evidence);
  if (instruction.kind === "classified")
    return {
      kind: "candidate",
      candidate: {
        source,
        ...instruction.route.destination,
        instructionPaths: instruction.route.paths,
        classification: "instruction",
        reason: "normalized_provider_instruction",
      },
    };
  if (instruction.kind !== "not_migration_candidate") return instruction;
  if (instruction.retained !== undefined)
    return { kind: "retained", retained: instruction.retained };
  if (source.kind !== "documentation") return { kind: "none" };
  const decision = classifyFlatDecision(source.path, source.content, taxonomy, evidence);
  if (decision.kind === "classified")
    return {
      kind: "candidate",
      candidate: {
        source,
        ...decision.destination,
        classification: "decision",
        reason: "recognized_decision_document",
      },
    };
  if (decision.kind !== "not_flat_decision") return decision;
  const document = classifyRepositoryDocument(source.path, source.content, taxonomy, evidence);
  if (document.kind === "classified")
    return {
      kind: "candidate",
      candidate: {
        source,
        ...document.destination,
        classification: "document",
        reason: "classified_repository_document",
      },
    };
  if (document.kind === "role_placed") return placedRole(source, document.placement, existingPaths);
  if (document.kind !== "not_migration_candidate") return document;
  return document.retained === undefined
    ? { kind: "none" }
    : { kind: "retained", retained: document.retained };
}
