import {
  isKnowledgeConvergenceDefinition,
  type KnowledgeConvergenceDefinition,
  type KnowledgeConvergenceDefinitionPublishStatus,
  type KnowledgeConvergenceDefinitionSummary,
} from "@lervo/sync-contract";

import type { HubKnowledgeConvergenceHostCoordinate } from "./knowledge-convergence-hosts.js";

/**
 * ADR-0477 Hub-hosted delegation-bound definitions, content-addressed per repository identity.
 * Implementations insert a new content hash or refresh the publication time of an existing one
 * inside one write transaction, keep at most `MAXIMUM_CONVERGENCE_DEFINITIONS` per repository
 * (least recently published pruned first), and list summaries newest first.
 */
export interface HubKnowledgeConvergenceDefinitionStore {
  publishKnowledgeConvergenceDefinition(input: {
    destinationId: string;
    definition: KnowledgeConvergenceDefinition;
    acceptedAt: string;
  }): Promise<{ status: KnowledgeConvergenceDefinitionPublishStatus }>;

  listKnowledgeConvergenceDefinitions(
    input: HubKnowledgeConvergenceHostCoordinate,
  ): Promise<KnowledgeConvergenceDefinitionSummary[]>;

  readKnowledgeConvergenceDefinition(
    input: HubKnowledgeConvergenceHostCoordinate & { contentHash: string },
  ): Promise<KnowledgeConvergenceDefinition | null>;
}

export class HubKnowledgeConvergenceDefinitionError extends Error {
  constructor(
    readonly code: "knowledge_convergence_definition_invalid",
    message: string,
  ) {
    super(message);
    this.name = "HubKnowledgeConvergenceDefinitionError";
  }
}

export async function handleKnowledgeConvergenceDefinitionPublish(input: {
  store: HubKnowledgeConvergenceDefinitionStore;
  destinationId: string;
  coordinate: { projectId: string; repositoryIdentityHash: string };
  definition: unknown;
  acceptedAt: string;
}): Promise<{ status: KnowledgeConvergenceDefinitionPublishStatus; contentHash: string }> {
  if (
    !Number.isFinite(Date.parse(input.acceptedAt)) ||
    !isKnowledgeConvergenceDefinition(input.definition) ||
    input.definition.projectId !== input.coordinate.projectId ||
    input.definition.repositoryIdentityHash !== input.coordinate.repositoryIdentityHash
  )
    throw new HubKnowledgeConvergenceDefinitionError(
      "knowledge_convergence_definition_invalid",
      "The knowledge convergence definition is invalid.",
    );
  const { status } = await input.store.publishKnowledgeConvergenceDefinition({
    destinationId: input.destinationId,
    definition: input.definition,
    acceptedAt: input.acceptedAt,
  });
  return { status, contentHash: input.definition.contentHash };
}

export async function handleKnowledgeConvergenceDefinitionList(input: {
  store: HubKnowledgeConvergenceDefinitionStore;
  coordinate: HubKnowledgeConvergenceHostCoordinate;
}): Promise<{ definitions: KnowledgeConvergenceDefinitionSummary[] }> {
  return { definitions: await input.store.listKnowledgeConvergenceDefinitions(input.coordinate) };
}

/** A missing hash answers `{ definition: null }`, so a 404 always means an older Hub. */
export async function handleKnowledgeConvergenceDefinitionRead(input: {
  store: HubKnowledgeConvergenceDefinitionStore;
  coordinate: HubKnowledgeConvergenceHostCoordinate & { contentHash: string };
}): Promise<{ definition: KnowledgeConvergenceDefinition | null }> {
  return { definition: await input.store.readKnowledgeConvergenceDefinition(input.coordinate) };
}
