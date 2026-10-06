import {
  isKnowledgeConvergenceHostRecord,
  type KnowledgeConvergenceHostPublishStatus,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

export interface HubKnowledgeConvergenceHostCoordinate {
  destinationId: string;
  projectId: string;
  repositoryIdentityHash: string;
}

/**
 * ADR-0469 Hub-hosted continuity records, one per host of a repository identity.
 * Implementations apply `mergeKnowledgeConvergenceHostRecord` inside one write transaction, keep
 * at most `MAXIMUM_CONVERGENCE_HOST_RECORDS` per repository (stalest observation pruned first),
 * and list records newest first.
 */
export interface HubKnowledgeConvergenceHostStore {
  publishKnowledgeConvergenceHost(input: {
    destinationId: string;
    record: KnowledgeConvergenceHostRecord;
    acceptedAt: string;
  }): Promise<{
    status: KnowledgeConvergenceHostPublishStatus;
    record: KnowledgeConvergenceHostRecord;
  }>;

  listKnowledgeConvergenceHosts(
    input: HubKnowledgeConvergenceHostCoordinate,
  ): Promise<KnowledgeConvergenceHostRecord[]>;
}

export class HubKnowledgeConvergenceHostError extends Error {
  constructor(
    readonly code: "knowledge_convergence_host_invalid",
    message: string,
  ) {
    super(message);
    this.name = "HubKnowledgeConvergenceHostError";
  }
}

export async function handleKnowledgeConvergenceHostPublish(input: {
  store: HubKnowledgeConvergenceHostStore;
  destinationId: string;
  coordinate: { projectId: string; repositoryIdentityHash: string };
  record: unknown;
  acceptedAt: string;
}) {
  if (
    !Number.isFinite(Date.parse(input.acceptedAt)) ||
    !isKnowledgeConvergenceHostRecord(input.record) ||
    input.record.projectId !== input.coordinate.projectId ||
    input.record.repositoryIdentityHash !== input.coordinate.repositoryIdentityHash
  )
    throw new HubKnowledgeConvergenceHostError(
      "knowledge_convergence_host_invalid",
      "The knowledge convergence host record is invalid.",
    );
  return input.store.publishKnowledgeConvergenceHost({
    destinationId: input.destinationId,
    record: input.record,
    acceptedAt: input.acceptedAt,
  });
}

export async function handleKnowledgeConvergenceHostList(input: {
  store: HubKnowledgeConvergenceHostStore;
  coordinate: HubKnowledgeConvergenceHostCoordinate;
}): Promise<{ records: KnowledgeConvergenceHostRecord[] }> {
  return { records: await input.store.listKnowledgeConvergenceHosts(input.coordinate) };
}
