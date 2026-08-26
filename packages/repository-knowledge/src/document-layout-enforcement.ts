import {
  createDocumentLayoutPermit,
  evaluateDocumentLayout,
  type DocumentLayoutEvaluation,
  type DocumentLayoutOperation,
  type DocumentLayoutPermit,
  type DocumentLayoutSnapshotEntry,
} from "@lervo/documents";
import { loadDecisionTaxonomy, loadProjectManifest } from "@lervo/project";

import { stableId } from "./integrity.js";
import { loadRepositoryKnowledgePolicy } from "./policy.js";
import { providerSurfaceRoles } from "./provider-surface-descriptors.js";
import { scanRepositoryKnowledge } from "./scanner.js";
import { RepositoryKnowledgeError } from "./types.js";

export interface RepositoryDocumentOperation {
  path: string;
  action: "create" | "update" | "delete" | "move" | "move_update" | "unchanged" | "conflict";
  destinationPath?: string;
  expectedCurrentHash?: string;
  desiredHash?: string;
}

function layoutOperation(operation: RepositoryDocumentOperation): DocumentLayoutOperation | null {
  if (operation.action === "unchanged" || operation.action === "conflict") return null;
  const operationId = stableId("kdoclayoutop", {
    action: operation.action,
    path: operation.path,
    destinationPath: operation.destinationPath,
    expectedCurrentHash: operation.expectedCurrentHash,
    desiredHash: operation.desiredHash,
  });
  if (operation.action === "delete") return { operationId, action: "delete", path: operation.path };
  if (operation.action === "move" || operation.action === "move_update") {
    if (operation.destinationPath === undefined)
      throw new RepositoryKnowledgeError(
        "knowledge_plan_stale",
        "A document move has no destination path.",
      );
    return {
      operationId,
      action: operation.action,
      path: operation.path,
      destinationPath: operation.destinationPath,
      contentHash: operation.desiredHash ?? operation.expectedCurrentHash ?? "",
    };
  }
  return {
    operationId,
    action: operation.action,
    path: operation.path,
    contentHash: operation.desiredHash ?? "",
  };
}

export async function evaluateCurrentRepositoryDocumentLayout(input: {
  repositoryRoot: string;
  operations: readonly RepositoryDocumentOperation[];
}): Promise<DocumentLayoutEvaluation> {
  const [manifest, sourcePolicy, taxonomy] = await Promise.all([
    loadProjectManifest(input.repositoryRoot),
    loadRepositoryKnowledgePolicy(input.repositoryRoot),
    loadDecisionTaxonomy(input.repositoryRoot),
  ]);
  const scan = await scanRepositoryKnowledge({
    repositoryRoot: input.repositoryRoot,
    projectId: manifest.projectId,
    policy: sourcePolicy,
  });
  const snapshot: DocumentLayoutSnapshotEntry[] = scan.sources.flatMap((source) =>
    source.status === "included" && /\.mdx?$/iu.test(source.path) && source.contentHash !== null
      ? [{ path: source.path, contentHash: source.contentHash, ownership: "user" as const }]
      : [],
  );
  return evaluateDocumentLayout({
    snapshot,
    operations: input.operations.flatMap((operation) => {
      const converted = layoutOperation(operation);
      return converted === null ? [] : [converted];
    }),
    policy: taxonomy.documentPolicy.capacity,
    roles: [...taxonomy.documentPolicy.roles, ...providerSurfaceRoles()],
  });
}

export async function authorizeCurrentRepositoryDocumentLayout(input: {
  repositoryRoot: string;
  operations: readonly RepositoryDocumentOperation[];
  now?: Date;
}): Promise<DocumentLayoutPermit | null> {
  const hasDocumentMutation = input.operations.some(
    (operation) =>
      !["unchanged", "conflict"].includes(operation.action) &&
      (/\.mdx?$/iu.test(operation.path) || /\.mdx?$/iu.test(operation.destinationPath ?? "")),
  );
  if (!hasDocumentMutation) return null;
  const evaluation = await evaluateCurrentRepositoryDocumentLayout(input);
  if (evaluation.status === "blocked") {
    const blocker = evaluation.blockers[0]!;
    throw new RepositoryKnowledgeError(
      blocker.code,
      `The projected repository document layout is blocked by ${blocker.code}.`,
    );
  }
  return createDocumentLayoutPermit(evaluation, input.now);
}
