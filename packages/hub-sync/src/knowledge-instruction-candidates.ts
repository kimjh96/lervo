import {
  isKnowledgeInstructionCandidateRecord,
  type KnowledgeInstructionCandidatePublishStatus,
  type KnowledgeInstructionCandidateRecord,
} from "@lervo/sync-contract";

export interface HubKnowledgeInstructionCandidateCoordinate {
  destinationId: string;
  projectId: string;
  repositoryIdentityHash: string;
}

/**
 * ADR-0467 Hub-hosted owner-rule candidates. Implementations apply
 * `mergeKnowledgeInstructionCandidateRecord` inside one write transaction, keep at most
 * `MAXIMUM_INSTRUCTION_CANDIDATE_RECORDS` per repository (oldest resolved records first), and list
 * records newest first.
 */
export interface HubKnowledgeInstructionCandidateStore {
  publishKnowledgeInstructionCandidate(input: {
    destinationId: string;
    record: KnowledgeInstructionCandidateRecord;
    acceptedAt: string;
  }): Promise<{
    status: KnowledgeInstructionCandidatePublishStatus;
    record: KnowledgeInstructionCandidateRecord;
  }>;

  listKnowledgeInstructionCandidates(
    input: HubKnowledgeInstructionCandidateCoordinate,
  ): Promise<KnowledgeInstructionCandidateRecord[]>;
}

export class HubKnowledgeInstructionCandidateError extends Error {
  constructor(
    readonly code: "knowledge_instruction_candidate_invalid",
    message: string,
  ) {
    super(message);
    this.name = "HubKnowledgeInstructionCandidateError";
  }
}

export async function handleKnowledgeInstructionCandidatePublish(input: {
  store: HubKnowledgeInstructionCandidateStore;
  destinationId: string;
  coordinate: { projectId: string; repositoryIdentityHash: string };
  record: unknown;
  acceptedAt: string;
}) {
  if (
    !Number.isFinite(Date.parse(input.acceptedAt)) ||
    !isKnowledgeInstructionCandidateRecord(input.record) ||
    input.record.projectId !== input.coordinate.projectId ||
    input.record.repositoryIdentityHash !== input.coordinate.repositoryIdentityHash
  )
    throw new HubKnowledgeInstructionCandidateError(
      "knowledge_instruction_candidate_invalid",
      "The instruction candidate record is invalid.",
    );
  return input.store.publishKnowledgeInstructionCandidate({
    destinationId: input.destinationId,
    record: input.record,
    acceptedAt: input.acceptedAt,
  });
}

export async function handleKnowledgeInstructionCandidateList(input: {
  store: HubKnowledgeInstructionCandidateStore;
  coordinate: HubKnowledgeInstructionCandidateCoordinate;
}): Promise<{ records: KnowledgeInstructionCandidateRecord[] }> {
  return { records: await input.store.listKnowledgeInstructionCandidates(input.coordinate) };
}
