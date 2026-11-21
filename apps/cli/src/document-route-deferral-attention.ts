import {
  documentRouteDeferralResolution,
  type DocumentRouteDeferralResolution,
} from "@lervo/repository-knowledge";
import type { RepositoryLayoutDeferredDocument } from "@lervo/repository-knowledge";

/** Enough to name each waiting document without crowding lifecycle gates out of a turn. */
export const MAXIMUM_DOCUMENT_ROUTE_ATTENTION_ITEMS = 8;

/**
 * ADR-0476: what resolves one deferred document. Classification is agent-owned background work;
 * the owner can always decide instead through explicit metadata or the knowledge policy.
 */
export function documentRouteDeferralInstruction(
  document: Pick<RepositoryLayoutDeferredDocument, "path" | "reason" | "subject"> & {
    resolution?: DocumentRouteDeferralResolution;
  },
): string {
  const metadata =
    document.subject === "decision"
      ? "lervo.decision.route"
      : "lervo.document.route or lervo.document.role";
  const resolution = documentRouteDeferralResolution(document);
  if (resolution === "provider_unavailable")
    return `No provider is admitted to classify ${document.path}. Run lervo migrate knowledge --provider codex (or claude) after provider admission is available.`;
  if (resolution === "classification_invalid")
    return `The semantic classifier's answer for ${document.path} broke its review contract, so Lervo recorded no route and retries on a later cycle. To place it now, add ${metadata} front matter naming a configured route, or exclude the path in .lervo/knowledge/policy.yaml if it is not repository documentation.`;
  if (resolution === "destination_conflict")
    return `Resolve the occupied or ambiguous destination for ${document.path}, then rebuild the migration plan. The source remains in place.`;
  if (resolution === "destination_capacity")
    return `The destination directory for ${document.path} would exceed its document capacity, so Lervo holds the move and the source remains in place; nothing waits for the owner. A capacity override for that directory in .lervo/knowledge/document-layout.yaml, or ${metadata} front matter naming another route, releases it.`;
  return resolution === "route_metadata"
    ? `The semantic classifier could not place ${document.path} with confidence. Add ${metadata} front matter naming a configured route, or exclude the path in .lervo/knowledge/policy.yaml if it is not repository documentation.`
    : `The background knowledge resident classifies ${document.path} semantically under its delegation. To place it now, add ${metadata} front matter naming a configured route, or exclude the path in .lervo/knowledge/policy.yaml if it is not repository documentation.`;
}

export function documentRouteDeferralLines(
  documents: readonly (Pick<RepositoryLayoutDeferredDocument, "path" | "reason" | "subject"> & {
    resolution?: DocumentRouteDeferralResolution;
  })[],
  indent: string,
): string[] {
  return documents.map(
    (document) =>
      `${indent}deferred [${documentRouteDeferralResolution(document)}] ${document.path}`,
  );
}

/**
 * Non-gating lifecycle advisories, one per deferred document, for operating attention. ADR-0604:
 * a document whose classifier answer broke its contract is named first, with its own code.
 */
export function documentRouteDeferralAdvisories(
  documents: readonly RepositoryLayoutDeferredDocument[],
): Array<{ code: string; command: string; detail: string }> {
  const invalid = (document: RepositoryLayoutDeferredDocument) =>
    documentRouteDeferralResolution(document) === "classification_invalid";
  const ordered = [
    ...documents.filter((document) => invalid(document)),
    ...documents.filter((document) => !invalid(document)),
  ];
  return ordered.slice(0, MAXIMUM_DOCUMENT_ROUTE_ATTENTION_ITEMS).map((document) => ({
    code: invalid(document)
      ? "document_route_classification_invalid"
      : "document_route_classification_deferred",
    command: documentRouteDeferralInstruction(document),
    detail: `${document.path}: ${document.reason} (${documentRouteDeferralResolution(document)})`,
  }));
}
