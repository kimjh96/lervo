import type { ProjectStorage } from "@lervo/project-storage";
import {
  ConvergenceOwnership,
  createGitHubKnowledgePublicationForge,
  publishKnowledgeOutputs,
  type InstructionCandidateExchangeTransport,
  type KnowledgePublicationOutcome,
} from "@lervo/repository-knowledge-runtime";
import {
  createHubKnowledgeConvergenceOwnerClient,
  createHubKnowledgeInstructionCandidateClient,
} from "@lervo/sync";

/** Composes the ADR-0466 owner with the Hub lease adapter for CLI-hosted knowledge workers. */
export function createKnowledgeConvergenceOwnership(
  storage: ProjectStorage,
  provider?: "codex" | "claude",
): ConvergenceOwnership {
  return new ConvergenceOwnership({
    storage,
    ...(provider === undefined ? {} : { provider }),
    transport: (target) => createHubKnowledgeConvergenceOwnerClient(target),
  });
}

/** Publishes the owner's settled knowledge commits through the host's authenticated `gh`. */
export function createKnowledgePublisher(
  repositoryRoot: string,
): () => Promise<KnowledgePublicationOutcome> {
  const forge = createGitHubKnowledgePublicationForge({ repositoryRoot });
  return () => publishKnowledgeOutputs({ repositoryRoot, forge });
}

/** ADR-0467: exchanges owner-rule candidates through the same Hub as the owner lease. */
export const instructionCandidateTransport: InstructionCandidateExchangeTransport = (target) =>
  createHubKnowledgeInstructionCandidateClient(target);
