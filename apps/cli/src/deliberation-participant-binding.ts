import { workforceProviderForPolicyHash } from "@lervo/agent-organization";
import { deliberationPolicyHash } from "@lervo/deliberation";
import type { ProjectStorage } from "@lervo/project-storage";
import type { DeliberationOutcome } from "@lervo/schemas";

import {
  appendOrganizationEvent,
  projectOrganization,
} from "./agent-organization-event-mutation.js";
import type { DeliberationExecutionPlan, DeliberationParticipant } from "./deliberation-roles.js";

function providerAllowed(
  policyHash: string,
  selectedProvider: DeliberationParticipant["provider"],
): boolean {
  const workforceProvider = workforceProviderForPolicyHash(policyHash);
  return workforceProvider === "any" || workforceProvider === selectedProvider;
}

function withParticipantNames(
  plan: DeliberationExecutionPlan,
  names: ReadonlyMap<string, string>,
): DeliberationExecutionPlan {
  const participants = plan.participants.map((participant) => ({
    ...participant,
    role: {
      ...participant.role,
      name: names.get(participant.role.roleId) ?? participant.role.name,
    },
  }));
  const byRoleId = new Map(
    participants.map((participant) => [participant.role.roleId, participant]),
  );
  const participantFor = (participant: DeliberationParticipant): DeliberationParticipant => {
    const resolved = byRoleId.get(participant.role.roleId);
    if (resolved === undefined) throw new Error("A deliberation participant role is missing.");
    return resolved;
  };
  return {
    ...plan,
    participants,
    proposer: participantFor(plan.proposer),
    reviewers: plan.reviewers.map(participantFor),
    verifier: participantFor(plan.verifier),
  };
}

export function bindAssignedDeliberationParticipants(input: {
  storage: ProjectStorage;
  deliberationId: string;
  plan: DeliberationExecutionPlan;
  conversationId?: string;
  boundAt: string;
}): DeliberationExecutionPlan {
  const organization = projectOrganization(input.storage);
  const existing = organization.deliberationParticipants.filter(
    (binding) => binding.deliberationId === input.deliberationId,
  );
  const policyHash = deliberationPolicyHash(input.plan.policy);
  if (existing.some((binding) => binding.deliberationPolicyHash !== policyHash)) {
    throw new Error("A deliberation participant binding names another policy revision.");
  }
  const names = new Map<string, string>();
  const pending: Array<{
    payload: Record<string, unknown>;
    roleId: string;
    displayName: string;
  }> = [];
  for (const participant of input.plan.participants) {
    const roleId = participant.role.roleId;
    const current = existing.filter((binding) => binding.roleId === roleId);
    if (current.length > 1) {
      throw new Error("A deliberation policy role has multiple durable-agent bindings.");
    }
    if (current.length === 1) {
      const binding = current[0]!;
      if (binding.releasedAt !== null) {
        throw new Error("A released deliberation participant cannot resume execution.");
      }
      const deployment = organization.deployments.find(
        (candidate) => candidate.deploymentId === binding.deploymentId,
      );
      const membership = organization.memberships.find(
        (candidate) => candidate.membershipId === binding.membershipId,
      );
      const displayName = deployment?.agentDisplayName ?? membership?.agentDisplayName;
      if (displayName === undefined) {
        throw new Error("A bound deliberation participant has no durable display name.");
      }
      names.set(roleId, displayName);
      continue;
    }
    if (input.conversationId === undefined || organization.team === null) continue;

    const candidates = organization.channelMemberships.flatMap((channel) => {
      if (channel.status !== "active" || channel.conversationId !== input.conversationId) return [];
      const deployment = organization.deployments.find(
        (candidate) =>
          candidate.deploymentId === channel.deploymentId && candidate.retiredAt === null,
      );
      const membership = organization.memberships.find(
        (candidate) =>
          candidate.membershipId === channel.membershipId &&
          candidate.status === "active" &&
          candidate.roleId === roleId &&
          providerAllowed(candidate.providerPolicyHash, participant.provider),
      );
      const displayName = deployment?.agentDisplayName ?? membership?.agentDisplayName;
      return deployment === undefined ||
        membership === undefined ||
        deployment.membershipId !== membership.membershipId ||
        deployment.participantId !== channel.participantId ||
        displayName === undefined
        ? []
        : [{ channel, deployment, membership, displayName }];
    });
    if (candidates.length === 0) continue;
    if (candidates.length > 1) {
      throw new Error("A deliberation policy role resolves to multiple channel-bound agents.");
    }
    const candidate = candidates[0]!;
    pending.push({
      roleId,
      displayName: candidate.displayName,
      payload: {
        deliberationId: input.deliberationId,
        deliberationPolicyHash: policyHash,
        organizationId: organization.team.organizationId,
        teamId: organization.team.teamId,
        projectId: organization.projectId,
        channelMembershipId: candidate.channel.channelMembershipId,
        membershipId: candidate.membership.membershipId,
        deploymentId: candidate.deployment.deploymentId,
        agentId: candidate.membership.agentId,
        participantId: candidate.channel.participantId,
        roleId,
        roleVersion: candidate.membership.roleVersion,
        roleContractHash: candidate.membership.roleContractHash,
        roleProfileHash: candidate.membership.roleProfileHash,
        providerPolicyHash: candidate.membership.providerPolicyHash,
        boundAt: input.boundAt,
      },
    });
  }
  for (const binding of pending) {
    appendOrganizationEvent(
      input.storage,
      "organization.deliberation.participant.bound",
      binding.payload,
    );
    names.set(binding.roleId, binding.displayName);
  }
  return withParticipantNames(input.plan, names);
}

export function releaseAssignedDeliberationParticipants(input: {
  storage: ProjectStorage;
  outcome: DeliberationOutcome;
  releasedAt: string;
}): void {
  const organization = projectOrganization(input.storage);
  if (organization.team === null) return;
  for (const binding of organization.deliberationParticipants.filter(
    (candidate) =>
      candidate.deliberationId === input.outcome.deliberationId && candidate.releasedAt === null,
  )) {
    appendOrganizationEvent(input.storage, "organization.deliberation.participant.released", {
      deliberationId: input.outcome.deliberationId,
      organizationId: organization.team.organizationId,
      teamId: organization.team.teamId,
      projectId: organization.projectId,
      agentId: binding.agentId,
      participantId: binding.participantId,
      outcomeId: input.outcome.outcomeId,
      status: input.outcome.status,
      releasedAt: input.releasedAt,
    });
  }
}
