import {
  deliberationExecutionRouteHash,
  deliberationParticipationAssignmentId,
  workforceProviderForPolicyHash,
} from "@lervo/agent-organization";
import { deliberationPolicyHash } from "@lervo/deliberation";
import type { ProjectStorage } from "@lervo/project-storage";
import type { DeliberationOutcome, DeliberationParticipantAssignment } from "@lervo/schemas";
import type { RoleProfile } from "@lervo/schemas";
import { assertRoleContractBinding, resolveRoleContract } from "@lervo/roles";

import {
  appendOrganizationEvent,
  projectOrganization,
} from "./agent-organization-event-mutation.js";
import type { DeliberationExecutionPlan } from "./deliberation-roles.js";

export interface BoundDeliberationParticipantExecution {
  agentId: string;
  participantId: string;
  provider: "codex" | "claude";
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  executionRouteHash: string;
  role: RoleProfile;
}

function executionRole(
  policyRole: RoleProfile,
  participant: BoundDeliberationParticipantExecution | undefined,
): RoleProfile {
  if (participant === undefined) return policyRole;
  const actual = participant.role;
  return {
    ...policyRole,
    name: actual.name,
    description: actual.description,
    requiredInputs: structuredClone(actual.requiredInputs),
    contextPolicy: {
      ...actual.contextPolicy,
      requiredDocumentRuleIds: [
        ...new Set([
          ...policyRole.contextPolicy.requiredDocumentRuleIds,
          ...actual.contextPolicy.requiredDocumentRuleIds,
        ]),
      ],
      referencesRequired:
        policyRole.contextPolicy.referencesRequired || actual.contextPolicy.referencesRequired,
    },
    defaultSkills: [...actual.defaultSkills],
  };
}

export function applyBoundDeliberationParticipantRoles(
  plan: DeliberationExecutionPlan,
  executions: ReadonlyMap<string, BoundDeliberationParticipantExecution>,
): DeliberationExecutionPlan {
  const participants = plan.participants.map((participant) => ({
    ...participant,
    role: executionRole(participant.role, executions.get(participant.role.roleId)),
  }));
  const proposer = participants.find((participant) =>
    participant.responsibilities.includes("proposer"),
  );
  const reviewers = participants.filter((participant) =>
    participant.responsibilities.includes("reviewer"),
  );
  const verifier = participants.find((participant) =>
    participant.responsibilities.includes("verifier"),
  );
  if (proposer === undefined || reviewers.length === 0 || verifier === undefined) {
    throw new Error("The bound deliberation execution roles are incomplete.");
  }
  return { ...plan, participants, proposer, reviewers, verifier };
}

function providerAllowed(
  assignment: DeliberationParticipantAssignment,
  selectedProvider: "codex" | "claude",
): boolean {
  const workforceProvider = workforceProviderForPolicyHash(assignment.providerPolicyHash);
  return (
    (workforceProvider === "any" || workforceProvider === assignment.provider) &&
    assignment.provider === selectedProvider
  );
}

function verifyAssignment(input: {
  storage: ProjectStorage;
  plan: DeliberationExecutionPlan;
  assignment: DeliberationParticipantAssignment;
}): void {
  const { assignment } = input;
  const participant = input.plan.participants.find(
    (candidate) => candidate.role.roleId === assignment.policyRoleId,
  );
  const organization = projectOrganization(input.storage);
  const membership = organization.memberships.find(
    (candidate) =>
      candidate.status === "active" &&
      candidate.membershipId === assignment.membershipId &&
      candidate.agentId === assignment.agentId &&
      candidate.roleId === assignment.agentRoleId &&
      candidate.roleVersion === assignment.roleVersion &&
      candidate.roleContractHash === assignment.roleContractHash &&
      candidate.roleProfileHash === assignment.roleProfileHash &&
      candidate.providerPolicyHash === assignment.providerPolicyHash,
  );
  const deployment = organization.deployments.find(
    (candidate) =>
      candidate.retiredAt === null &&
      candidate.deploymentId === assignment.deploymentId &&
      candidate.membershipId === assignment.membershipId &&
      candidate.agentId === assignment.agentId &&
      candidate.participantId === assignment.participantId &&
      candidate.roleId === assignment.agentRoleId &&
      candidate.roleVersion === assignment.roleVersion &&
      candidate.roleContractHash === assignment.roleContractHash &&
      candidate.roleProfileHash === assignment.roleProfileHash &&
      candidate.providerPolicyHash === assignment.providerPolicyHash,
  );
  const channel = organization.channelMemberships.find(
    (candidate) =>
      candidate.status === "active" &&
      candidate.channelMembershipId === assignment.channelMembershipId &&
      candidate.deploymentId === assignment.deploymentId &&
      candidate.membershipId === assignment.membershipId &&
      candidate.agentId === assignment.agentId &&
      candidate.participantId === assignment.participantId &&
      candidate.conversationId === assignment.conversationId &&
      candidate.integrationId === deployment?.integrationId,
  );
  // ADR-0612 M2c: a seat the model selection routes binds only its provider, so its hash covers
  // no model or effort and the assignment carries the role's current model and effort.
  const routeHashes =
    deployment === undefined
      ? []
      : [
          deliberationExecutionRouteHash({
            participantId: assignment.participantId,
            integrationId: deployment.integrationId,
            provider: assignment.provider,
            model: assignment.model,
            reasoningEffort: assignment.reasoningEffort,
          }),
          deliberationExecutionRouteHash({
            participantId: assignment.participantId,
            integrationId: deployment.integrationId,
            provider: assignment.provider,
            model: null,
            reasoningEffort: null,
          }),
        ];
  const participationAssignmentId = deliberationParticipationAssignmentId({
    deliberationId: assignment.deliberationId,
    policyId: assignment.policyId,
    policyRoleId: assignment.policyRoleId,
    agentId: assignment.agentId,
    executionRouteHash: assignment.executionRouteHash,
  });
  if (
    assignment.projectId !== input.storage.manifest.projectId ||
    organization.team === null ||
    assignment.organizationId !== organization.team.organizationId ||
    assignment.teamId !== organization.team.teamId ||
    assignment.policyId !== input.plan.policy.policyId ||
    participant === undefined ||
    membership === undefined ||
    deployment === undefined ||
    channel === undefined ||
    !routeHashes.includes(assignment.executionRouteHash) ||
    participationAssignmentId !== assignment.participationAssignmentId ||
    !providerAllowed(assignment, participant.provider)
  ) {
    throw new Error("The explicit deliberation participant assignment is not executable.");
  }
}

async function execution(
  repositoryRoot: string,
  assignment: DeliberationParticipantAssignment,
): Promise<BoundDeliberationParticipantExecution> {
  const contract = await resolveRoleContract(repositoryRoot, assignment.agentRoleId);
  assertRoleContractBinding(contract, {
    roleId: assignment.agentRoleId,
    roleVersion: assignment.roleVersion,
    roleContractHash: assignment.roleContractHash,
    roleProfileHash: assignment.roleProfileHash,
  });
  return {
    agentId: assignment.agentId,
    participantId: assignment.participantId,
    provider: assignment.provider,
    ...(assignment.model === null ? {} : { model: assignment.model }),
    ...(assignment.reasoningEffort === null ? {} : { reasoningEffort: assignment.reasoningEffort }),
    executionRouteHash: assignment.executionRouteHash,
    role: structuredClone(contract.definition.profile),
  };
}

export async function bindAssignedDeliberationParticipants(input: {
  storage: ProjectStorage;
  deliberationId: string;
  plan: DeliberationExecutionPlan;
  assignments?: readonly DeliberationParticipantAssignment[];
}): Promise<ReadonlyMap<string, BoundDeliberationParticipantExecution>> {
  const assignments = input.assignments ?? [];
  const policyHash = deliberationPolicyHash(input.plan.policy);
  const organization = projectOrganization(input.storage);
  const activeNamedBindings = organization.deliberationParticipants.filter(
    (candidate) =>
      candidate.deliberationId === input.deliberationId &&
      candidate.releasedAt === null &&
      candidate.bindingVersion === 2,
  );
  if (assignments.length === 0) {
    if (activeNamedBindings.length > 0) {
      throw new Error("Resuming named deliberation participants requires their accepted routes.");
    }
    return new Map();
  }
  if (
    new Set(assignments.map((assignment) => assignment.policyRoleId)).size !== assignments.length
  ) {
    throw new Error("A deliberation policy seat has multiple participant assignments.");
  }
  if (
    activeNamedBindings.length > 0 &&
    (activeNamedBindings.length !== assignments.length ||
      activeNamedBindings.some(
        (binding) =>
          !assignments.some(
            (assignment) =>
              assignment.participationAssignmentId === binding.participationAssignmentId,
          ),
      ))
  ) {
    throw new Error("The resumed named deliberation participant set changed.");
  }
  if (organization.team === null) {
    throw new Error("Named deliberation participants require an installed organization team.");
  }
  const result = new Map<string, BoundDeliberationParticipantExecution>();
  for (const assignment of assignments) {
    if (assignment.deliberationId !== input.deliberationId) {
      throw new Error("The participant assignment names another deliberation.");
    }
    verifyAssignment({ ...input, assignment });
    const existing = organization.deliberationParticipants.filter(
      (candidate) =>
        candidate.deliberationId === input.deliberationId &&
        candidate.roleId === assignment.policyRoleId,
    );
    if (existing.length > 1) {
      throw new Error("A deliberation policy seat has multiple durable-agent bindings.");
    }
    if (existing.length === 1) {
      const binding = existing[0]!;
      if (
        binding.releasedAt !== null ||
        binding.bindingVersion !== 2 ||
        binding.participationAssignmentId !== assignment.participationAssignmentId ||
        binding.policyId !== assignment.policyId ||
        binding.agentId !== assignment.agentId ||
        binding.participantId !== assignment.participantId ||
        binding.executionRouteHash !== assignment.executionRouteHash ||
        binding.deliberationPolicyHash !== policyHash
      ) {
        throw new Error("The resumed deliberation participant binding changed.");
      }
    } else {
      appendOrganizationEvent(input.storage, "organization.deliberation.participant.bound", {
        deliberationId: input.deliberationId,
        deliberationPolicyHash: policyHash,
        policyId: assignment.policyId,
        organizationId: assignment.organizationId,
        teamId: assignment.teamId,
        projectId: assignment.projectId,
        channelMembershipId: assignment.channelMembershipId,
        membershipId: assignment.membershipId,
        deploymentId: assignment.deploymentId,
        agentId: assignment.agentId,
        participantId: assignment.participantId,
        roleId: assignment.policyRoleId,
        bindingVersion: 2,
        participationAssignmentId: assignment.participationAssignmentId,
        policyRoleId: assignment.policyRoleId,
        agentRoleId: assignment.agentRoleId,
        roleVersion: assignment.roleVersion,
        roleContractHash: assignment.roleContractHash,
        roleProfileHash: assignment.roleProfileHash,
        providerPolicyHash: assignment.providerPolicyHash,
        executionRouteHash: assignment.executionRouteHash,
        executionProvider: assignment.provider,
        acceptedAt: assignment.acceptedAt,
        boundAt: assignment.acceptedAt,
      });
    }
    result.set(
      assignment.policyRoleId,
      await execution(input.storage.paths.repositoryRoot, assignment),
    );
  }
  return result;
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
