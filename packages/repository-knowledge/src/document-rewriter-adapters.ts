import { resolve } from "node:path";

import {
  evaluateDocumentRewriters,
  type DocumentRewriteDryRunObservation,
  type DocumentRewriteOwnership,
  type DocumentRewriterDescriptor,
} from "@lervo/documents";
import { loadDecisionTaxonomy, loadDocumentRegistry } from "@lervo/project";

import { inspectConfiguredDocumentNormalization } from "./document-normalization.js";
import { sha256 } from "./integrity.js";
import { projectRepositoryPrettierRewrite } from "./prettier-rewriter-adapter.js";

export function contentBoundTransformDescriptor(input: {
  rewriterId: string;
  version: string;
  scopePaths: string[];
  configurationHash: string;
  lockHash: string;
  maximumObservations: number;
}): DocumentRewriterDescriptor {
  return {
    ...input,
    capability: "transform",
    compatibility: {
      kind: "content_bound_dry_run",
      maximumObservations: input.maximumObservations,
    },
  };
}

export async function inspectRepositoryDocumentRewriters(input: {
  repositoryRoot: string;
  allowTransactionPlanId?: string;
  transformDescriptor?: DocumentRewriterDescriptor;
  transformObservations?: readonly DocumentRewriteDryRunObservation[];
}): Promise<{
  prettierDescriptor: DocumentRewriterDescriptor;
  prettierIgnore: {
    beforeContent: string | null;
    afterContent: string;
    rules: string[];
    userRegionHash: string;
    approvalRequired: boolean;
  };
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
  const ownedPaths = ownership.map((item) => item.path);
  const prettier = await projectRepositoryPrettierRewrite({
    repositoryRoot: root,
    ownedPaths,
    supplementalDocumentPaths: Object.values(registry.documents).map((record) => record.path),
  });
  const prettierDescriptor = prettier.descriptor;
  const rewriters = [
    prettierDescriptor,
    ...(input.transformDescriptor === undefined ? [] : [input.transformDescriptor]),
  ];
  const evaluation = evaluateDocumentRewriters({
    ownership,
    rewriters,
    managedRules: { prettier: prettier.rules },
    dryRuns:
      input.transformDescriptor === undefined
        ? {}
        : { [input.transformDescriptor.rewriterId]: input.transformObservations ?? [] },
    contract: taxonomy.documentPolicy.rewrite,
    policyHash: sha256(JSON.stringify(taxonomy.documentPolicy)),
  });
  return {
    prettierDescriptor,
    prettierIgnore: {
      beforeContent: prettier.beforeContent,
      afterContent: prettier.afterContent,
      rules: prettier.rules,
      userRegionHash: prettier.userRegionHash,
      approvalRequired: prettier.approvalRequired,
    },
    ownership,
    ...evaluation,
  };
}
