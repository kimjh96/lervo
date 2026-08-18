import { discoverInstructionDocuments } from "./discovery.js";
import { loadContextPlan } from "./loading.js";
import { createContextPlan } from "./selection.js";
import type { LoadedContext, PrepareContextInput } from "./types.js";

export async function prepareContext(input: PrepareContextInput): Promise<LoadedContext> {
  const instructionDocuments = await discoverInstructionDocuments({
    repositoryRoot: input.repositoryRoot,
    registry: input.registry,
    expectedPaths: input.expectedPaths,
  });
  const plan = createContextPlan({
    coordinates: input.coordinates,
    registry: input.registry,
    role: input.role,
    expectedPaths: input.expectedPaths,
    documentRules: input.documentRules,
    instructionDocuments,
    publications: input.publications,
    handoffs: input.handoffs,
    policyVersion: input.policyVersion,
    recordedAt: input.recordedAt,
    ...(input.createReceiptId === undefined
      ? {}
      : { createReceiptId: input.createReceiptId }),
  });
  return loadContextPlan({
    repositoryRoot: input.repositoryRoot,
    plan,
    sourceRevision: input.sourceRevision,
    recordedAt: input.recordedAt,
    ...(input.createReceiptId === undefined
      ? {}
      : { createReceiptId: input.createReceiptId }),
  });
}
