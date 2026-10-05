import {
  isKnowledgeConvergenceOwnerMutation,
  type KnowledgeConvergenceOwnerDecision,
  type KnowledgeConvergenceOwnerMutation,
  type KnowledgeConvergenceOwnerReading,
} from "@lervo/sync-contract";

export interface HubKnowledgeConvergenceOwnerCoordinate {
  destinationId: string;
  projectId: string;
  repositoryIdentityHash: string;
}

/**
 * ADR-0466 Hub-hosted convergence owner lease. Implementations apply
 * `decideKnowledgeConvergenceOwnerMutation` inside one serializable transaction and resolve only
 * after commit, so two hosts can never both receive `granted` for overlapping lifetimes.
 */
export interface HubKnowledgeConvergenceOwnerStore {
  mutateKnowledgeConvergenceOwner(input: {
    destinationId: string;
    mutation: KnowledgeConvergenceOwnerMutation;
    acceptedAt: string;
  }): Promise<KnowledgeConvergenceOwnerDecision>;

  readKnowledgeConvergenceOwner(
    input: HubKnowledgeConvergenceOwnerCoordinate & { acceptedAt: string },
  ): Promise<KnowledgeConvergenceOwnerReading>;
}

export class HubKnowledgeConvergenceOwnerError extends Error {
  constructor(
    readonly code: "knowledge_convergence_owner_invalid",
    message: string,
  ) {
    super(message);
    this.name = "HubKnowledgeConvergenceOwnerError";
  }
}

function acceptedTime(value: string): void {
  if (!Number.isFinite(Date.parse(value)))
    throw new HubKnowledgeConvergenceOwnerError(
      "knowledge_convergence_owner_invalid",
      "The convergence owner acceptance time is invalid.",
    );
}

export async function handleKnowledgeConvergenceOwnerMutation(input: {
  store: HubKnowledgeConvergenceOwnerStore;
  destinationId: string;
  coordinate: { projectId: string; repositoryIdentityHash: string };
  mutation: unknown;
  acceptedAt: string;
}): Promise<KnowledgeConvergenceOwnerDecision> {
  acceptedTime(input.acceptedAt);
  if (
    !isKnowledgeConvergenceOwnerMutation(input.mutation) ||
    input.mutation.request.projectId !== input.coordinate.projectId ||
    input.mutation.request.repositoryIdentityHash !== input.coordinate.repositoryIdentityHash
  )
    throw new HubKnowledgeConvergenceOwnerError(
      "knowledge_convergence_owner_invalid",
      "The convergence owner mutation is invalid.",
    );
  return input.store.mutateKnowledgeConvergenceOwner({
    destinationId: input.destinationId,
    mutation: input.mutation,
    acceptedAt: input.acceptedAt,
  });
}

export async function handleKnowledgeConvergenceOwnerRead(input: {
  store: HubKnowledgeConvergenceOwnerStore;
  coordinate: HubKnowledgeConvergenceOwnerCoordinate;
  acceptedAt: string;
}): Promise<KnowledgeConvergenceOwnerReading> {
  acceptedTime(input.acceptedAt);
  return input.store.readKnowledgeConvergenceOwner({
    ...input.coordinate,
    acceptedAt: input.acceptedAt,
  });
}
