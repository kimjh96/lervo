import type { DecisionTaxonomy, DecisionTaxonomyRoute } from "@lervo/project";

import type { ApplicationContentEvidence } from "./application-content-evidence.js";
import {
  documentRouteSetDigest,
  type DocumentRouteSubject,
} from "./document-route-classification-contract.js";
import { placeableDocumentRole, type PlaceableDocumentRole } from "./document-role-catalog.js";
import {
  documentRouteClassificationDigest,
  documentRouteClassificationId,
  type DocumentRouteClassificationRecord,
} from "./document-route-classification-store.js";

/**
 * What a layout plan may rely on to place a document (ADR-0476). Explicit metadata and an exact
 * legacy alias the reviewed layout declares for a role are repository declarations; a semantic
 * route cites recorded provider evidence. Title terms, heading words, and file-name stems are
 * never a basis.
 */
export type DocumentRouteBasis =
  "explicit_metadata" | "reviewed_layout_alias" | "semantic_provider";

export interface SemanticRouteEvidence {
  classificationId: string;
  /** `sha256` of the exact recorded classification the plan relied on. */
  recordDigest: string;
  provider: "codex" | "claude";
  requestDigest: string;
  responseDigest: string;
  observationArtifactHash: string | null;
}

export type DocumentRouteDeferralReason =
  | "semantic_classification_pending"
  | "semantic_classification_uncertain"
  | "destination_conflict"
  | "delegation_scope";

export type DocumentRouteDeferralResolution =
  | "background_classification"
  | "delegation_scope"
  | "route_metadata"
  | "provider_unavailable"
  | "destination_conflict";

/** Readers of plans predating ADR-0540 retain their original background resolution. */
export function documentRouteDeferralResolution(document: {
  resolution?: DocumentRouteDeferralResolution;
}): DocumentRouteDeferralResolution {
  return document.resolution ?? "background_classification";
}

export interface DocumentRouteResolutionContext {
  providerAvailable: boolean;
  normalizationRoots: readonly string[];
}

/** A legacy document waiting for a semantic route; it never blocks the rest of the plan. */
export interface DeferredDocumentRoute {
  /** The classification that would resolve it, bound to these bytes and this route set. */
  classificationId: string;
  subject: DocumentRouteSubject;
  path: string;
  contentHash: string;
  reason: DocumentRouteDeferralReason;
  resolution: DocumentRouteDeferralResolution;
  basis?: string;
  destination?: string;
  requiredPaths?: string[];
}

/** Why a Markdown file outside the canonical layout stays where it is. */
export type RetainedDocumentPlacement =
  | { path: string; basis: "application_content"; evidence: ApplicationContentEvidence[] }
  | { path: string; basis: "semantic_provider"; semanticClassification: SemanticRouteEvidence };

export interface DocumentRouteEvidence {
  classifications: ReadonlyMap<string, DocumentRouteClassificationRecord>;
  applicationContent: ReadonlyMap<string, readonly ApplicationContentEvidence[]>;
}

export const noDocumentRouteEvidence: DocumentRouteEvidence = {
  classifications: new Map(),
  applicationContent: new Map(),
};

const routeSetDigests = new WeakMap<DecisionTaxonomy, string>();

function routeSetDigest(taxonomy: DecisionTaxonomy): string {
  const cached = routeSetDigests.get(taxonomy);
  if (cached !== undefined) return cached;
  const digest = documentRouteSetDigest(taxonomy);
  routeSetDigests.set(taxonomy, digest);
  return digest;
}

export type SemanticRouteResolution =
  | { kind: "route"; route: DecisionTaxonomyRoute; evidence: SemanticRouteEvidence }
  | { kind: "role"; role: PlaceableDocumentRole; evidence: SemanticRouteEvidence }
  | { kind: "retain_in_place"; evidence: SemanticRouteEvidence }
  | { kind: "deferred"; deferral: DeferredDocumentRoute };

/**
 * Reads the recorded classification bound to these exact bytes and this exact route set. Any
 * other state, including a record for older bytes or older routes, defers the document.
 */
export function recordedSemanticRoute(input: {
  subject: DocumentRouteSubject;
  path: string;
  contentHash: string;
  taxonomy: DecisionTaxonomy;
  evidence: DocumentRouteEvidence;
}): SemanticRouteResolution {
  const classificationId = documentRouteClassificationId({
    subject: input.subject,
    path: input.path,
    contentHash: input.contentHash,
    routeSetDigest: routeSetDigest(input.taxonomy),
  });
  const record = input.evidence.classifications.get(classificationId);
  const deferral = (reason: DocumentRouteDeferralReason): SemanticRouteResolution => ({
    kind: "deferred",
    deferral: {
      classificationId,
      subject: input.subject,
      path: input.path,
      contentHash: input.contentHash,
      reason,
      resolution:
        reason === "semantic_classification_uncertain"
          ? "route_metadata"
          : "background_classification",
    },
  });
  if (record === undefined) return deferral("semantic_classification_pending");
  const evidence: SemanticRouteEvidence = {
    classificationId,
    recordDigest: documentRouteClassificationDigest(record),
    provider: record.evidence.provider,
    requestDigest: record.evidence.requestDigest,
    responseDigest: record.evidence.responseDigest,
    observationArtifactHash: record.evidence.observationArtifactHash,
  };
  if (record.outcome === "retain_in_place") return { kind: "retain_in_place", evidence };
  if (record.outcome === "role") {
    const role = placeableDocumentRole(input.taxonomy, record.roleId ?? "");
    return role === null
      ? deferral("semantic_classification_uncertain")
      : { kind: "role", role, evidence };
  }
  const route =
    record.outcome === "route"
      ? input.taxonomy.routes.find((candidate) => candidate.id === record.routeId)
      : undefined;
  return route === undefined
    ? deferral("semantic_classification_uncertain")
    : { kind: "route", route, evidence };
}
