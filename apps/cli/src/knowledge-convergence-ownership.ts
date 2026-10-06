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
  type KnowledgePublicationRepairEvents,
} from "@lervo/repository-knowledge-runtime";
import {
  createHubKnowledgeConvergenceHostClient,
  createHubKnowledgeConvergenceOwnerClient,
  createHubKnowledgeInstructionCandidateClient,
} from "@lervo/sync";

import { knowledgeHostHubCandidates } from "./knowledge-host-hub-candidates.js";

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

/**
 * Publishes the owner's settled knowledge commits through the host's authenticated `gh`. The
 * caller's event store, when given, receives `knowledge.publication.repaired` (ADR-0471).
 */
export function createKnowledgePublisher(
  repositoryRoot: string,
): (context?: {
  events: KnowledgePublicationRepairEvents;
}) => Promise<KnowledgePublicationOutcome> {
  const forge = createGitHubKnowledgePublicationForge({ repositoryRoot });
  return (context) =>
    publishKnowledgeOutputs({
      repositoryRoot,
      forge,
      ...(context === undefined ? {} : { events: context.events }),
    });
}

/** ADR-0467: exchanges owner-rule candidates through the same Hub as the owner lease. */
export const instructionCandidateTransport: InstructionCandidateExchangeTransport = (target) =>
  createHubKnowledgeInstructionCandidateClient(target);

/**
 * ADR-0469 continuity for a CLI-hosted resident or worker. Hub candidates come from the Node
 * registered for this checkout, then from other Hub-coordinated repositories on this host.
 */
export function createKnowledgeConvergenceContinuity(
  storage: ProjectStorage,
): ConvergenceContinuity {
  return new ConvergenceContinuity({
    storage,
    policyPath: defaultConvergenceContinuityPolicyPath(),
    hubCandidates: () => knowledgeHostHubCandidates(storage.paths.repositoryRoot),
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
