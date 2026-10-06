import { hostname, release } from "node:os";

import type { ProjectStorage } from "@lervo/project-storage";
import {
  ConvergenceContinuity,
  ConvergenceOwnership,
  convergenceHostLabel,
  defaultConvergenceContinuityPolicyPath,
  probeKnowledgePublicationSettings,
  createGitHubKnowledgePublicationForge,
  publishKnowledgeOutputs,
  type InstructionCandidateExchangeTransport,
  type KnowledgePublicationOutcome,
} from "@lervo/repository-knowledge-runtime";
import {
  createHubKnowledgeConvergenceHostClient,
  createHubKnowledgeConvergenceOwnerClient,
  createHubKnowledgeInstructionCandidateClient,
} from "@lervo/sync";

import type { KnowledgeHubCoordinates } from "./knowledge-hub-coordinates.js";

/** Composes the ADR-0466 owner with the Hub lease adapter for Node-hosted knowledge residents. */
export function createKnowledgeConvergenceOwnership(
  storage: ProjectStorage,
  provider: "codex" | "claude",
): ConvergenceOwnership {
  return new ConvergenceOwnership({
    storage,
    provider,
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

/**
 * ADR-0469 continuity for a Node-hosted resident: the Node's own Hub coordinates are the only
 * candidate, so a checkout registered with a Node becomes Hub-coordinated without operator input.
 */
export function createKnowledgeConvergenceContinuity(
  storage: ProjectStorage,
  hub: KnowledgeHubCoordinates | null,
): ConvergenceContinuity {
  return new ConvergenceContinuity({
    storage,
    policyPath: defaultConvergenceContinuityPolicyPath(),
    hubCandidates: async () => (hub === null ? [] : [{ source: "node_runtime", hub }]),
    transport: (target) => createHubKnowledgeConvergenceHostClient(target),
    publication: () =>
      probeKnowledgePublicationSettings({ repositoryRoot: storage.paths.repositoryRoot }),
    hostLabel: convergenceHostLabel({
      platform: process.platform,
      release: release(),
      hostname: hostname(),
    }),
  });
}
