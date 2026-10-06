import type { RepositoryLayoutDeferredDocument } from "@lervo/repository-knowledge";

/** Enough to name each waiting document without crowding lifecycle gates out of a turn. */
export const MAXIMUM_DOCUMENT_ROUTE_ATTENTION_ITEMS = 8;

/**
 * ADR-0476: what resolves one deferred document. Classification is agent-owned background work;
 * the owner can always decide instead through explicit metadata or the knowledge policy.
 */
export function documentRouteDeferralInstruction(
  document: Pick<RepositoryLayoutDeferredDocument, "path" | "reason" | "subject">,
): string {
  const metadata =
    document.subject === "decision" ? "lervo.decision.route" : "lervo.document.route";
  return document.reason === "semantic_classification_uncertain"
    ? `The semantic classifier could not place ${document.path} with confidence. Add ${metadata} front matter naming a configured route, or exclude the path in .lervo/knowledge/policy.yaml if it is not repository documentation.`
    : `The background knowledge resident classifies ${document.path} semantically under its delegation. To place it now, add ${metadata} front matter naming a configured route, or exclude the path in .lervo/knowledge/policy.yaml if it is not repository documentation.`;
}

export function documentRouteDeferralLines(
  documents: readonly Pick<RepositoryLayoutDeferredDocument, "path" | "reason" | "subject">[],
  indent: string,
): string[] {
  return documents.map((document) => `${indent}deferred [${document.reason}] ${document.path}`);
}

/** Non-gating lifecycle advisories, one per deferred document, for operating attention. */
export function documentRouteDeferralAdvisories(
  documents: readonly RepositoryLayoutDeferredDocument[],
): Array<{ code: string; command: string; detail: string }> {
  return documents.slice(0, MAXIMUM_DOCUMENT_ROUTE_ATTENTION_ITEMS).map((document) => ({
    code: "document_route_classification_deferred",
    command: documentRouteDeferralInstruction(document),
    detail: `${document.path}: ${document.reason}`,
  }));
}
