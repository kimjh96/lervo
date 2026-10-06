import { basename, posix } from "node:path";

import type { DecisionTaxonomy, DecisionTaxonomyRoute } from "@lervo/project";

import {
  declaredLegacyAliasRole,
  placeableDocumentRole,
  type PlaceableDocumentRole,
} from "./document-role-catalog.js";
export { repositoryInstructionPaths } from "./document-front-matter.js";
import { explicitDocumentPlacement, repositoryInstructionPaths } from "./document-front-matter.js";
import { sha256 } from "./integrity.js";
import {
  noDocumentRouteEvidence,
  recordedSemanticRoute,
  type DeferredDocumentRoute,
  type DocumentRouteBasis,
  type DocumentRouteEvidence,
  type RetainedDocumentPlacement,
  type SemanticRouteEvidence,
} from "./document-route-resolution.js";

export type DocumentLayoutBlockerCode =
  "invalid_document_metadata" | "unknown_document_role" | "unknown_document_route";

export interface DocumentLayoutBlocker {
  code: DocumentLayoutBlockerCode;
  path: string;
  candidateRouteIds?: string[];
}

export interface ClassifiedDocumentDestination {
  toPath: string;
  routeId: string;
  routePath: string;
  group: string;
  subgroup?: string;
  classificationBasis: DocumentRouteBasis;
  /** Present exactly when the basis is `semantic_provider`. */
  semanticClassification?: SemanticRouteEvidence;
}

/** A document that fills a repository document role, such as the product vision. */
export interface DocumentRolePlacement {
  toPath: string;
  roleId: string;
  classificationBasis: DocumentRouteBasis;
  /** Present exactly when the basis is `semantic_provider`. */
  semanticClassification?: SemanticRouteEvidence;
}

export type RepositoryDocumentClassification =
  | { kind: "not_migration_candidate"; retained?: RetainedDocumentPlacement }
  | { kind: "role_placed"; placement: DocumentRolePlacement }
  | { kind: "blocked"; blocker: DocumentLayoutBlocker }
  | { kind: "deferred"; deferral: DeferredDocumentRoute }
  | { kind: "classified"; destination: ClassifiedDocumentDestination };

export interface RepositoryInstructionRoute {
  paths: string[];
  destination: ClassifiedDocumentDestination;
}

const CONVENTIONAL_ENTRYPOINTS = new Set([
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "LICENSE.md",
]);

const RESERVED_DOCUMENT_TREES = [
  "architecture",
  "archive",
  "decisions",
  "evidence",
  "inherited",
  "instructions",
  "knowledge",
  "product",
  "research",
  "roadmap",
  "specifications",
  "specs",
];

const BYTE_PRESERVED_DOCUMENT_TREES = new Set(["archive", "inherited"]);

function documentRoot(taxonomy: DecisionTaxonomy): string {
  return posix.dirname(taxonomy.decisionRoot);
}

/** The repository documentation root the reviewed layout declares, such as `docs`. */
export function repositoryDocumentationRoot(taxonomy: DecisionTaxonomy): string {
  return documentRoot(taxonomy);
}

function preservedRolePath(path: string, taxonomy: DecisionTaxonomy): boolean {
  return taxonomy.documentPolicy.roles.some(
    (role) => role.relocation === "preserve" && role.path === path,
  );
}

export function bytePreservedDocumentCollection(path: string, taxonomy: DecisionTaxonomy): boolean {
  const root = documentRoot(taxonomy);
  return [...BYTE_PRESERVED_DOCUMENT_TREES].some((tree) => path.startsWith(`${root}/${tree}/`));
}

function alreadyCanonical(path: string, taxonomy: DecisionTaxonomy): boolean {
  const root = documentRoot(taxonomy);
  if (preservedRolePath(path, taxonomy)) return true;
  if (taxonomy.routes.some((route) => path.startsWith(`${root}/${route.path}/`))) return true;
  return RESERVED_DOCUMENT_TREES.some((tree) => path.startsWith(`${root}/${tree}/`));
}

/**
 * Structural candidacy from the reviewed layout: canonical trees, declared roles, local
 * entrypoints, and provider surfaces are never legacy documents. Content evidence is separate.
 */
export function structuralMigrationCandidate(path: string, taxonomy: DecisionTaxonomy): boolean {
  if (!/\.mdx?$/iu.test(path)) return false;
  // Reviewed normalization creates bounded sibling topic families beside a
  // package README. They inherit that local entrypoint's placement instead of
  // becoming unrelated legacy documents on the next layout pass.
  if (/(?:^|\/)README\/.*\.mdx?$/iu.test(path)) return false;
  if (
    !path.includes("/") &&
    (basename(path) === "README.md" || CONVENTIONAL_ENTRYPOINTS.has(basename(path)))
  )
    return false;
  // A README next to a package or subsystem remains its local entrypoint. A
  // README at the documentation root is repository documentation and must be
  // classified like every other legacy document; its basename alone is not a
  // sufficient reason to bypass migration.
  if (basename(path) === "README.md" && posix.dirname(path) !== documentRoot(taxonomy))
    return false;
  if (CONVENTIONAL_ENTRYPOINTS.has(basename(path))) return false;
  if (/^(?:\.agents|\.claude|\.codex|\.github)\//u.test(path)) return false;
  return !alreadyCanonical(path, taxonomy);
}

function destination(
  toDirectory: string,
  filename: string,
  route: DecisionTaxonomyRoute,
  basis: { kind: "explicit_metadata" } | { kind: "semantic"; evidence: SemanticRouteEvidence },
): ClassifiedDocumentDestination {
  const [group, ...subgroupParts] = route.path.split("/");
  return {
    toPath: `${toDirectory}/${route.path}/${filename}`,
    routeId: route.id,
    routePath: route.path,
    group: group!,
    ...(subgroupParts.length === 0 ? {} : { subgroup: subgroupParts.join("/") }),
    ...(basis.kind === "explicit_metadata"
      ? { classificationBasis: "explicit_metadata" as const }
      : {
          classificationBasis: "semantic_provider" as const,
          semanticClassification: basis.evidence,
        }),
  };
}

type PlacementBasis =
  | { kind: "explicit_metadata" }
  | { kind: "reviewed_layout_alias" }
  | { kind: "semantic"; evidence: SemanticRouteEvidence };

function rolePlacement(role: PlaceableDocumentRole, basis: PlacementBasis): DocumentRolePlacement {
  return {
    toPath: role.path,
    roleId: role.roleId,
    ...(basis.kind === "semantic"
      ? {
          classificationBasis: "semantic_provider" as const,
          semanticClassification: basis.evidence,
        }
      : { classificationBasis: basis.kind }),
  };
}

type RoutedDocument =
  | { kind: "blocked"; blocker: DocumentLayoutBlocker }
  | { kind: "role"; role: PlaceableDocumentRole; basis: PlacementBasis }
  | { kind: "deferred"; deferral: DeferredDocumentRoute }
  | { kind: "retained"; evidence: SemanticRouteEvidence }
  | {
      kind: "routed";
      route: DecisionTaxonomyRoute;
      filename?: string;
      basis: { kind: "explicit_metadata" } | { kind: "semantic"; evidence: SemanticRouteEvidence };
    };

/**
 * Explicit `lervo.document.route` or `lervo.document.role` metadata, the owner's declaration;
 * null when absent. A role declaration applies only to repository documents.
 */
function explicitlyRouted(
  path: string,
  content: string,
  taxonomy: DecisionTaxonomy,
  allowRole: boolean,
): RoutedDocument | null {
  const metadata = explicitDocumentPlacement(content);
  if (metadata.state === "absent") return null;
  if (metadata.state === "invalid" || (metadata.roleId !== undefined && !allowRole))
    return { kind: "blocked", blocker: { code: "invalid_document_metadata", path } };
  if (metadata.roleId !== undefined) {
    const role = placeableDocumentRole(taxonomy, metadata.roleId);
    return role === null
      ? {
          kind: "blocked",
          blocker: { code: "unknown_document_role", path, candidateRouteIds: [metadata.roleId] },
        }
      : { kind: "role", role, basis: { kind: "explicit_metadata" } };
  }
  const routeId = metadata.routeId ?? "";
  const route = taxonomy.routes.find((candidate) => candidate.id === routeId);
  return route === undefined
    ? {
        kind: "blocked",
        blocker: { code: "unknown_document_route", path, candidateRouteIds: [routeId] },
      }
    : {
        kind: "routed",
        route,
        ...(metadata.filename === undefined ? {} : { filename: metadata.filename }),
        basis: { kind: "explicit_metadata" },
      };
}

/** Recorded semantic evidence bound to these bytes and routes, else a deferral. */
function semanticallyRouted(input: {
  subject: "document" | "instruction";
  path: string;
  content: string;
  taxonomy: DecisionTaxonomy;
  evidence: DocumentRouteEvidence;
}): RoutedDocument {
  const semantic = recordedSemanticRoute({
    subject: input.subject,
    path: input.path,
    contentHash: sha256(input.content),
    taxonomy: input.taxonomy,
    evidence: input.evidence,
  });
  if (semantic.kind === "deferred") return semantic;
  if (semantic.kind === "retain_in_place") return { kind: "retained", evidence: semantic.evidence };
  if (semantic.kind === "role")
    return {
      kind: "role",
      role: semantic.role,
      basis: { kind: "semantic", evidence: semantic.evidence },
    };
  return {
    kind: "routed",
    route: semantic.route,
    basis: { kind: "semantic", evidence: semantic.evidence },
  };
}

export function classifyClaudeRule(
  path: string,
  content: string,
  taxonomy: DecisionTaxonomy,
  evidence: DocumentRouteEvidence = noDocumentRouteEvidence,
):
  | { kind: "not_migration_candidate"; retained?: RetainedDocumentPlacement }
  | { kind: "blocked"; blocker: DocumentLayoutBlocker }
  | { kind: "deferred"; deferral: DeferredDocumentRoute }
  | { kind: "classified"; route: RepositoryInstructionRoute } {
  if (!/(^|\/)\.claude\/rules\/.+\.md$/u.test(path)) return { kind: "not_migration_candidate" };
  const routed =
    explicitlyRouted(path, content, taxonomy, false) ??
    semanticallyRouted({ subject: "instruction", path, content, taxonomy, evidence });
  if (routed.kind === "blocked" || routed.kind === "deferred") return routed;
  // The response contract admits roles only for documents, so an instruction never gets one.
  if (routed.kind === "role")
    return { kind: "blocked", blocker: { code: "invalid_document_metadata", path } };
  if (routed.kind === "retained")
    return {
      kind: "not_migration_candidate",
      retained: { path, basis: "semantic_provider", semanticClassification: routed.evidence },
    };
  return {
    kind: "classified",
    route: {
      paths: repositoryInstructionPaths(content),
      destination: destination(
        `${documentRoot(taxonomy)}/instructions`,
        basename(path),
        routed.route,
        routed.basis,
      ),
    },
  };
}

/**
 * Places one legacy repository document. Explicit metadata is the owner's declaration, then an
 * exact legacy alias the reviewed layout declares for a role. Otherwise application content its
 * own package consumes is never a candidate, and everything else needs recorded semantic
 * evidence. A document without it is deferred, never blocking (ADR-0476).
 */
export function classifyRepositoryDocument(
  path: string,
  content: string,
  taxonomy: DecisionTaxonomy,
  evidence: DocumentRouteEvidence = noDocumentRouteEvidence,
): RepositoryDocumentClassification {
  if (!structuralMigrationCandidate(path, taxonomy)) return { kind: "not_migration_candidate" };
  const aliasRole = declaredLegacyAliasRole(taxonomy, path);
  const declared: RoutedDocument | null =
    explicitlyRouted(path, content, taxonomy, true) ??
    (aliasRole === null
      ? null
      : { kind: "role", role: aliasRole, basis: { kind: "reviewed_layout_alias" } });
  const consumed = evidence.applicationContent.get(path);
  if (declared === null && consumed !== undefined && consumed.length > 0)
    return {
      kind: "not_migration_candidate",
      retained: { path, basis: "application_content", evidence: [...consumed] },
    };
  const routed =
    declared ?? semanticallyRouted({ subject: "document", path, content, taxonomy, evidence });
  if (routed.kind === "blocked" || routed.kind === "deferred") return routed;
  if (routed.kind === "retained")
    return {
      kind: "not_migration_candidate",
      retained: { path, basis: "semantic_provider", semanticClassification: routed.evidence },
    };
  if (routed.kind === "role")
    return { kind: "role_placed", placement: rolePlacement(routed.role, routed.basis) };
  return {
    kind: "classified",
    destination: destination(
      documentRoot(taxonomy),
      routed.filename ?? basename(path),
      routed.route,
      routed.basis,
    ),
  };
}
