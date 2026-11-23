import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  applyKnowledgeDocumentDeletionPlan,
  applyKnowledgeDocumentMergePlan,
  applyKnowledgeDocumentMovePlan,
  applyKnowledgeDocumentSplitPlan,
  createKnowledgeDocumentDeletionPlan,
  createKnowledgeDocumentMergePlan,
  createKnowledgeDocumentMovePlan,
  createKnowledgeDocumentSplitPlan,
  serializableKnowledgeDocumentDeletionPlan,
  serializableKnowledgeDocumentMergePlan,
  serializableKnowledgeDocumentMovePlan,
  serializableKnowledgeDocumentSplitPlan,
  type RepositorySupplementalSource,
} from "@lervo/repository-knowledge";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo, CliServices } from "./types.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import {
  applyDocumentStructureOperation,
  type DocumentStructureOperation,
  type DocumentStructurePlan,
} from "./document-structure-apply.js";
import { crossCheckPlan } from "./plan-cross-check.js";
import { REMOVED_APPROVE_ITEM } from "./removed-approval-options.js";

const APPLY =
  "an independent cross-check reviews it first, and the commit it creates is the undo point";

function operationCounts(plan: DocumentStructurePlan, extraUpdates = 0) {
  return {
    created: plan.operations.filter((item) => item.action === "create").length,
    updated: plan.operations.filter((item) => item.action === "update").length + extraUpdates,
    unchanged: plan.operations.filter((item) => item.action === "unchanged").length,
  };
}

/** The plan text, its JSON form, and the cross-checked apply of one structure operation. */
async function planStructureOperation(
  operation: "move" | "merge" | "split" | "delete",
  positionals: string[],
  headingLocator: string | undefined,
  repositoryRoot: string,
  supplementalSources: RepositorySupplementalSource[],
): Promise<{
  text: string;
  json: unknown;
  structure: DocumentStructureOperation<DocumentStructurePlan, { planId: string }>;
}> {
  if (operation === "move") {
    const plan = await createKnowledgeDocumentMovePlan({
      repositoryRoot,
      fromPath: positionals[0]!,
      toPath: positionals[1]!,
      supplementalSources,
    });
    return {
      text: `User document move plan created.\nplan: ${plan.planId}\nsource: ${plan.document.fromPath} · ${plan.document.contentHash} · ${plan.document.byteCount} bytes\ndestination: ${plan.document.toPath}\npreserved concepts: ${plan.preservedConceptIds.length}\nDocuments, sidecars, and navigation have not been changed. Apply with --apply ${plan.planId}; ${APPLY}.\n`,
      json: serializableKnowledgeDocumentMovePlan(plan),
      structure: {
        operation,
        plan,
        reason: `moved ${plan.document.fromPath} to ${plan.document.toPath}`,
        conceptIds: {
          created: plan.createdConceptIds,
          updated: plan.updatedConceptIds,
          deprecated: plan.deprecatedConceptIds,
        },
        counts: () => operationCounts(plan, 1),
        apply: (input) => applyKnowledgeDocumentMovePlan({ plan, ...input }),
        describe: (receipt: Awaited<ReturnType<typeof applyKnowledgeDocumentMovePlan>>) =>
          `Moved the user document while preserving concept identity, source-unit lineage, and ${receipt.relocatedNormalizationRecords.length} normalization records.\nplan: ${receipt.planId}\npreserved concepts: ${receipt.preservedConceptIds.length}\nsource digest: ${receipt.fromPathDigest}\ndestination digest: ${receipt.toPathDigest}`,
      },
    };
  }
  if (operation === "merge") {
    const plan = await createKnowledgeDocumentMergePlan({
      repositoryRoot,
      sourcePath: positionals[0]!,
      destinationPath: positionals[1]!,
      supplementalSources,
    });
    return {
      text: `User document merge plan created.\nplan: ${plan.planId}\nsource: ${plan.source.path} · ${plan.source.contentHash} · ${plan.source.byteCount} bytes\ndestination: ${plan.destination.path} · ${plan.destination.beforeHash} → ${plan.destination.afterHash}\ncomposition: destination_then_source\ndeprecated concepts: ${plan.deprecatedConceptIds.length}\nDocuments, lineage, sidecars, and navigation have not been changed. Apply with --apply ${plan.planId}; ${APPLY}.\n`,
      json: serializableKnowledgeDocumentMergePlan(plan),
      structure: {
        operation,
        plan,
        reason: `merged ${plan.source.path} into ${plan.destination.path}`,
        conceptIds: {
          created: plan.createdConceptIds,
          updated: plan.updatedConceptIds,
          deprecated: plan.deprecatedConceptIds,
        },
        counts: () => operationCounts(plan),
        apply: (input) => applyKnowledgeDocumentMergePlan({ plan, ...input }),
        describe: (receipt: Awaited<ReturnType<typeof applyKnowledgeDocumentMergePlan>>) =>
          `Merged the source document into the destination byte-for-byte and updated knowledge navigation.\nplan: ${receipt.planId}\nmerged bytes: ${receipt.mergedByteCount}\nsource digest: ${receipt.sourcePathDigest}\ndestination digest: ${receipt.destinationPathDigest}`,
      },
    };
  }
  if (operation === "split") {
    const plan = await createKnowledgeDocumentSplitPlan({
      repositoryRoot,
      sourcePath: positionals[0]!,
      destinationPath: positionals[1]!,
      headingLocator: headingLocator!,
      supplementalSources,
    });
    return {
      text: `User document split plan created.\nplan: ${plan.planId}\nsource: ${plan.source.path} · ${plan.source.beforeHash} → ${plan.source.afterHash}\ndestination: ${plan.destination.path} · ${plan.destination.contentHash}\nheading: ${plan.heading.locator} · byte ${plan.heading.startByte}..${plan.heading.endByte}\nDocuments, lineage, sidecars, and navigation have not been changed. Apply with --apply ${plan.planId}; ${APPLY}.\n`,
      json: serializableKnowledgeDocumentSplitPlan(plan),
      structure: {
        operation,
        plan,
        reason: `split ${plan.heading.locator} of ${plan.source.path} into ${plan.destination.path}`,
        conceptIds: {
          created: plan.createdConceptIds,
          updated: plan.updatedConceptIds,
          deprecated: plan.deprecatedConceptIds,
        },
        counts: () => operationCounts(plan),
        apply: (input) => applyKnowledgeDocumentSplitPlan({ plan, ...input }),
        describe: (receipt: Awaited<ReturnType<typeof applyKnowledgeDocumentSplitPlan>>) =>
          `Split the heading subtree into a new user document and updated knowledge navigation.\nplan: ${receipt.planId}\nextracted bytes: ${receipt.extractedByteCount}\nsource digest: ${receipt.sourcePathDigest}\ndestination digest: ${receipt.destinationPathDigest}`,
      },
    };
  }
  const plan = await createKnowledgeDocumentDeletionPlan({
    repositoryRoot,
    documentPath: positionals[0]!,
    supplementalSources,
  });
  return {
    text: `User document deletion plan created.\nplan: ${plan.planId}\ntarget: ${plan.document.path} · ${plan.document.contentHash} · ${plan.document.byteCount} bytes\ndeprecated concepts: ${plan.deprecatedConceptIds.length}\nDocuments and sidecars have not been changed. Apply with --apply ${plan.planId}; ${APPLY}, and Git holds the document's bytes before it is deleted.\n`,
    json: serializableKnowledgeDocumentDeletionPlan(plan),
    structure: {
      operation,
      plan,
      reason: `deleted ${plan.document.path} and deprecated its concepts`,
      deletedPath: plan.document.path,
      replan: async () =>
        (
          await planStructureOperation(
            operation,
            positionals,
            headingLocator,
            repositoryRoot,
            supplementalSources,
          )
        ).structure,
      conceptIds: { created: [], updated: [], deprecated: plan.deprecatedConceptIds },
      counts: (receipt: Awaited<ReturnType<typeof applyKnowledgeDocumentDeletionPlan>>) => ({
        created: 0,
        updated: receipt.updatedSidecars.length,
        unchanged: 0,
      }),
      apply: (input) => applyKnowledgeDocumentDeletionPlan({ plan, ...input }),
      describe: (receipt: Awaited<ReturnType<typeof applyKnowledgeDocumentDeletionPlan>>) =>
        `Deleted the user document and deprecated linked concepts.\nplan: ${receipt.planId}\ndeprecated concepts: ${receipt.deprecatedConceptIds.length}\npath digest: ${receipt.deletedPathDigest}`,
    },
  };
}

/**
 * `lervo knowledge structure delete|move|merge|split` (ADR-0181 to ADR-0184). ADR-0561: `--apply` runs an
 * independent cross-check of the exact plan, applies it, and commits it as the undo point.
 */
export async function runKnowledgeStructure(
  args: string[],
  io: CliIo,
  services: Partial<Pick<CliServices, "crossCheckPlan">> = {},
): Promise<number> {
  try {
    const structureOperation = args[0];
    if (
      structureOperation !== "delete" &&
      structureOperation !== "move" &&
      structureOperation !== "merge" &&
      structureOperation !== "split"
    )
      throw new Error("The structure command supports delete, move, merge, and split.");
    if (args.some((arg) => /^--approve-item(?:=|$)/u.test(arg)))
      throw new Error(REMOVED_APPROVE_ITEM);
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        apply: { type: "string" },
        "cross-check-provider": { type: "string" },
        "at-heading": { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (
      (structureOperation === "move" || structureOperation === "merge") &&
      parsed.positionals.length !== 2
    )
      throw new Error(
        `structure ${structureOperation} requires source and destination repository-relative Markdown paths.`,
      );
    if (
      structureOperation === "split" &&
      (parsed.positionals.length !== 2 || parsed.values["at-heading"] === undefined)
    )
      throw new Error(
        "structure split requires source, destination, and --at-heading <heading-locator>.",
      );
    if (structureOperation !== "split" && parsed.values["at-heading"] !== undefined)
      throw new Error("--at-heading may be used only with structure split.");
    if (structureOperation === "delete" && parsed.positionals.length !== 1)
      throw new Error("structure delete requires one repository-relative Markdown path.");
    const provider = parsed.values["cross-check-provider"];
    if (provider !== undefined && provider !== "codex" && provider !== "claude")
      throw new Error("--cross-check-provider must be codex or claude.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const supplementalSources = await collectLocalKnowledgeSources(repositoryRoot);
    const planned = await planStructureOperation(
      structureOperation,
      parsed.positionals,
      parsed.values["at-heading"],
      repositoryRoot,
      supplementalSources,
    );
    if (parsed.values.apply === undefined) {
      io.stdout(parsed.values.json ? `${JSON.stringify(planned.json, null, 2)}\n` : planned.text);
      return 0;
    }
    if (parsed.values.apply !== planned.structure.plan.planId)
      throw new Error(
        `The requested plan ID does not match the current document ${structureOperation} plan.`,
      );
    return await applyDocumentStructureOperation({
      repositoryRoot,
      structure: planned.structure,
      supplementalSources,
      ...(provider === undefined ? {} : { provider }),
      json: parsed.values.json === true,
      io,
      crossCheckPlan: services.crossCheckPlan ?? crossCheckPlan,
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}
