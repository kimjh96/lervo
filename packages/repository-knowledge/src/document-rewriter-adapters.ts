import { resolve } from "node:path";

import {
  evaluateDocumentRewriters,
  type DocumentRewriteCapability,
  type DocumentRewriteDryRunObservation,
  type DocumentRewriteOwnership,
  type DocumentRewriterDescriptor,
} from "@lervo/documents";
import { loadDecisionTaxonomy, loadDocumentRegistry } from "@lervo/project";

import { inspectConfiguredDocumentNormalization } from "./document-normalization.js";
import { sha256 } from "./integrity.js";
import type { RepositoryKnowledgeScanOptions } from "./types.js";

export function contentBoundRewriterDescriptor(input: {
  rewriterId: string;
  version: string;
  capability: DocumentRewriteCapability;
  scopePaths: string[];
  configurationHash: string;
  lockHash: string;
  maximumObservations: number;
}): DocumentRewriterDescriptor {
  return {
    ...input,
    compatibility: {
      kind: "content_bound_dry_run",
      maximumObservations: input.maximumObservations,
    },
  };
}

export function contentBoundTransformDescriptor(
  input: Omit<Parameters<typeof contentBoundRewriterDescriptor>[0], "capability">,
): DocumentRewriterDescriptor {
  return contentBoundRewriterDescriptor({ ...input, capability: "transform" });
}

export async function inspectRepositoryDocumentRewriters(input: {
  repositoryRoot: string;
  allowTransactionPlanId?: string;
  /**
   * ADR-0582: the evidence the caller scans with. Normalization records read their outputs from
   * disk, never from the scan, so this only lets the inspection reuse the caller's scan.
   */
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  rewriters?: readonly DocumentRewriterDescriptor[];
  managedRules?: Readonly<Record<string, readonly string[]>>;
  dryRuns?: Readonly<Record<string, readonly DocumentRewriteDryRunObservation[]>>;
}): Promise<{
  ownership: DocumentRewriteOwnership[];
  status: "compatible" | "blocked";
  blockers: ReturnType<typeof evaluateDocumentRewriters>["blockers"];
}> {
  const root = resolve(input.repositoryRoot);
  const [taxonomy, lifecycle, registry] = await Promise.all([
    loadDecisionTaxonomy(root),
    inspectConfiguredDocumentNormalization({
      repositoryRoot: root,
      ...(input.allowTransactionPlanId === undefined
        ? {}
        : { allowTransactionPlanId: input.allowTransactionPlanId }),
      ...(input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources }),
    }),
    loadDocumentRegistry(root),
  ]);
  const ownershipByPath = new Map<string, DocumentRewriteOwnership>();
  for (const record of Object.values(registry.documents)) {
    if (record.ownership.mode === "user") continue;
    ownershipByPath.set(record.path, {
      path: record.path,
      owner: record.ownership.mode === "managed_blocks" ? "shared_regions" : "lervo",
      rewritePolicy: "lervo_exact",
    });
  }
  for (const path of lifecycle.records.flatMap((record) =>
    record.status === "current" ? record.outputPaths : [],
  )) {
    ownershipByPath.set(path, { path, owner: "reviewer", rewritePolicy: "reviewed_exact" });
  }
  const ownership = [...ownershipByPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const evaluation = evaluateDocumentRewriters({
    ownership,
    rewriters: input.rewriters ?? [],
    managedRules: input.managedRules ?? {},
    dryRuns: input.dryRuns ?? {},
    contract: taxonomy.documentPolicy.rewrite,
    policyHash: sha256(JSON.stringify(taxonomy.documentPolicy)),
  });
  return {
    ownership,
    ...evaluation,
  };
}
