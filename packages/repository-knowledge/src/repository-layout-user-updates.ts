import type { DurableKnowledgeUserFileOperation } from "./durable-apply.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { projectRebuildableKnowledgeIgnore } from "./projection-ignore.js";
import type { RepositoryLayoutUserUpdate } from "./repository-layout-plan.js";
import type { RepositoryLayoutReferenceChange } from "./repository-layout-references.js";
import type { RepositorySource } from "./types.js";

function mediaTypeFor(source: RepositorySource): DurableKnowledgeUserFileOperation["mediaType"] {
  if (/\.mdx?$/iu.test(source.path)) return "text/markdown";
  if (/\.json$/iu.test(source.path)) return "application/json";
  if (/\.ya?ml$/iu.test(source.path)) return "application/yaml";
  if (/\.[cm]?js$/iu.test(source.path)) return "text/javascript";
  if (/\.[cm]?tsx?$/iu.test(source.path)) return "text/typescript";
  return "text/plain";
}

/**
 * The user-file updates for rewritten references, in path order. Without a document move they
 * stand alone, so each one carries its own exact content binding.
 */
export function planRepositoryLayoutReferenceUpdates(input: {
  projectId: string;
  referenceChanges: ReadonlyMap<string, RepositoryLayoutReferenceChange>;
  documentMoveCount: number;
}): {
  referenceOperations: DurableKnowledgeUserFileOperation[];
  referenceUserUpdates: RepositoryLayoutUserUpdate[];
} {
  const referenceOperations: DurableKnowledgeUserFileOperation[] = [
    ...input.referenceChanges.values(),
  ]
    .sort((left, right) => left.source.path.localeCompare(right.source.path))
    .map((change) => ({
      path: change.source.path,
      action: "update",
      ownership: "user",
      mediaType: mediaTypeFor(change.source),
      content: change.content,
      expectedCurrentHash: change.source.contentHash,
      desiredHash: sha256(change.content),
    }));
  const referenceUserUpdates: RepositoryLayoutUserUpdate[] =
    input.documentMoveCount === 0
      ? referenceOperations.map((operation) => {
          const operationId = stableId("kdocop", {
            projectId: input.projectId,
            action: "refresh_instruction_routes",
            path: operation.path,
            beforeHash: operation.expectedCurrentHash,
            afterHash: operation.desiredHash,
          });
          return {
            operationId,
            approvalHash: sha256(
              canonicalJson({
                operationId,
                action: "update_user_document",
                path: operation.path,
                beforeHash: operation.expectedCurrentHash,
                afterHash: operation.desiredHash,
              }),
            ),
            path: operation.path,
            beforeHash: operation.expectedCurrentHash!,
            afterHash: operation.desiredHash,
            reason:
              operation.path === "AGENTS.md"
                ? ("refresh_instruction_routes" as const)
                : ("normalize_agent_surface_references" as const),
          };
        })
      : [];
  return { referenceOperations, referenceUserUpdates };
}

/** The `.gitignore` write that keeps the rebuildable publication root out of version control. */
export async function planRepositoryLayoutPublicationIgnore(input: {
  root: string;
  projectId: string;
  publicationRoot: string;
}): Promise<{
  operations: DurableKnowledgeUserFileOperation[];
  userUpdates: RepositoryLayoutUserUpdate[];
}> {
  const publicationIgnore = await projectRebuildableKnowledgeIgnore({
    repositoryRoot: input.root,
    publicationRoot: input.publicationRoot,
  });
  if (!publicationIgnore.changed) return { operations: [], userUpdates: [] };
  const operationId = stableId("kdocop", {
    projectId: input.projectId,
    action: "exclude_rebuildable_publications",
    path: publicationIgnore.path,
    beforeHash: publicationIgnore.beforeHash,
    afterHash: publicationIgnore.afterHash,
  });
  return {
    operations: [
      {
        path: publicationIgnore.path,
        action: publicationIgnore.beforeContent === null ? "create" : "update",
        ownership: "user",
        mediaType: "text/plain",
        content: publicationIgnore.afterContent,
        ...(publicationIgnore.beforeHash === null
          ? {}
          : { expectedCurrentHash: publicationIgnore.beforeHash }),
        desiredHash: publicationIgnore.afterHash,
      },
    ],
    userUpdates: [
      {
        operationId,
        approvalHash: sha256(
          canonicalJson({
            operationId,
            action: "write_user_configuration",
            path: publicationIgnore.path,
            beforeHash: publicationIgnore.beforeHash,
            afterHash: publicationIgnore.afterHash,
          }),
        ),
        path: publicationIgnore.path,
        beforeHash: publicationIgnore.beforeHash,
        afterHash: publicationIgnore.afterHash,
        reason: "exclude_rebuildable_publications",
      },
    ],
  };
}
