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
  type KnowledgeHubChangeTransport,
  type KnowledgePublicationOutcome,
  type KnowledgePublicationRepairEvents,
} from "@lervo/repository-knowledge-runtime";
import {
  createHubKnowledgeChangeClient,
  createHubKnowledgeConvergenceHostClient,
  createHubKnowledgeConvergenceOwnerClient,
  createHubKnowledgeInstructionCandidateClient,
} from "@lervo/sync";

import { knowledgeHostHubCandidates } from "./knowledge-host-hub-candidates.js";
import { readFollowControl } from "./host-follow-state.js";
import { hostUpgradeLayout, type HostUpgradeLayout } from "./host-upgrade-layout.js";

/** Composes the ADR-0466 owner with the Hub lease adapter for CLI-hosted knowledge workers. */
export function createKnowledgeConvergenceOwnership(
  storage: ProjectStorage,
  provider?: "codex" | "claude",
): ConvergenceOwnership {
  return new ConvergenceOwnership({
    storage,
    ...(provider === undefined ? {} : { provider }),
    transport: (target) => createHubKnowledgeConvergenceOwnerClient(target),
    continuityPolicyPath: defaultConvergenceContinuityPolicyPath(),
  });
}

/**
 * Publishes the owner's settled knowledge commits through the host's authenticated `gh`. The
 * caller's event store, when given, receives `knowledge.publication.repaired` (ADR-0473).
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
      mergeHold: releaseTrainHold,
      ...(context === undefined ? {} : { events: context.events }),
    });
}

/** ADR-0467: exchanges owner-rule candidates through the same Hub as the owner lease. */
export const instructionCandidateTransport: InstructionCandidateExchangeTransport = (target) =>
  createHubKnowledgeInstructionCandidateClient(target);

/** ADR-0602: waits on the same Hub for another host's knowledge coordination changes. */
export const knowledgeHubChangeTransport: KnowledgeHubChangeTransport = (target) =>
  createHubKnowledgeChangeClient(target);

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

/**
 * While this host's release follower is paused, a CLI release train is between its cut and its
 * tag: merging a knowledge publication then moves main and supersedes the release's preparation.
 * The publication waits as at any merge gate and merges once the follower resumes.
 */
export async function releaseTrainHold(
  layout: HostUpgradeLayout = hostUpgradeLayout({}),
): Promise<string | null> {
  const control = await readFollowControl(layout).catch(() => null);
  return control?.paused === true ? "release_train" : null;
}
