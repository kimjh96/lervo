import { resolve } from "node:path";

import {
  evaluateDocumentRewriters,
  type DocumentRewriteDryRunObservation,
  type DocumentRewriteOwnership,
  type DocumentRewriterDescriptor,
} from "@lervo/documents";
import { loadDecisionTaxonomy } from "@lervo/project";

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
  const [taxonomy, lifecycle] = await Promise.all([
    loadDecisionTaxonomy(root),
    inspectConfiguredDocumentNormalization({
      repositoryRoot: root,
      ...(input.allowTransactionPlanId === undefined
        ? {}
        : { allowTransactionPlanId: input.allowTransactionPlanId }),
    }),
  ]);
  const ownedPaths = [
    ...new Set(
      lifecycle.records.flatMap((record) =>
        record.status === "current" ? record.outputPaths : [],
      ),
    ),
  ].sort();
  const ownership: DocumentRewriteOwnership[] = ownedPaths.map((path) => ({
    path,
    owner: "reviewer",
    rewritePolicy: "reviewed_exact",
  }));
  const prettier = await projectRepositoryPrettierRewrite({
    repositoryRoot: root,
    ownedPaths,
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
