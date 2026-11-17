import { loadDecisionTaxonomy } from "@lervo/project";
import {
  canonicalJson,
  evaluateCurrentRepositoryDocumentLayout,
  sha256,
} from "@lervo/repository-knowledge";
import type { CanonicalDraft } from "./canonical-assessment-contract.js";

/** Routing advice and parking identity share the same authoritative apply-time layout evaluator. */
export async function canonicalDocumentLayout(
  root: string,
  drafts: readonly CanonicalDraft[] = [],
) {
  const [taxonomy, evaluation] = await Promise.all([
    loadDecisionTaxonomy(root),
    evaluateCurrentRepositoryDocumentLayout({
      repositoryRoot: root,
      operations: drafts.map((draft) => ({
        path: draft.path,
        action: draft.beforeHash === null ? "create" : "update",
        desiredHash: sha256(draft.content),
      })),
    }),
  ]);
  const guidance = {
    decisionRoot: taxonomy.decisionRoot,
    routes: taxonomy.routes,
    maxLeafDocuments: taxonomy.maxLeafDocuments,
    capacity: taxonomy.documentPolicy.capacity,
    roles: taxonomy.documentPolicy.roles,
    observed: evaluation.observed,
  };
  return {
    guidance,
    evaluation,
    worseningBlockers: evaluation.blockers,
    // Document edits do not release capacity; layout policy, routing, and counts do.
    capacityHash: sha256(canonicalJson(guidance)),
  };
}

/** Only overflow the drafts create or grow parks a batch; existing overflow is lint debt. */
export function capacityBlocked(layout: Awaited<ReturnType<typeof canonicalDocumentLayout>>) {
  const blockers = layout.worseningBlockers;
  return (
    blockers.length > 0 &&
    blockers.every(
      (blocker) =>
        blocker.code === "document_directory_file_capacity_exceeded" ||
        blocker.code === "document_directory_child_capacity_exceeded" ||
        blocker.code === "document_repository_capacity_exceeded",
    )
  );
}
