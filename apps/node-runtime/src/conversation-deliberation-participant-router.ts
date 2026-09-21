import {
  deliberationExecutionRouteHash,
  deliberationParticipationAssignmentId,
  projectAgentOrganizationFromEventSource,
  workforceProviderForPolicyHash,
} from "@lervo/agent-organization";
import type { DeliberationParticipantAssignment } from "@lervo/schemas";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import type { DiscordAgentParticipation } from "./discord-agent-participation.js";

export interface ConversationDeliberationParticipantAssignmentPort {
  preflight(input: { policyId: string; projectId: string; conversationId: string }): {
    participantIds: string[];
  };
  assign(input: {
    deliberationId: string;
    policyId: string | null;
    projectId: string;
    conversationId: string | null;
    acceptedAt: string;
  }): DeliberationParticipantAssignment[];
  attach(input: {
    participantId: string;
    artifacts: ArtifactStore;
    handle(event: ConversationInboundEvent): Promise<Array<{ result: unknown }>>;
    deliver(integrationId: string): Promise<unknown>;
  }): () => void;
  publish(input: {
    participantId: string;
    projectId: string;
    conversationId: string;
    threadId: string | null;
    replyToEventId: string;
    artifactEventId: string;
    content: string;
    occurredAt: string;
  }): Promise<void>;
}

interface ParticipantEndpoint {
  config: NodeDiscordConversationConfig;
  participation: DiscordAgentParticipation;
  runtime?: {
    artifacts: ArtifactStore;
    handle(event: ConversationInboundEvent): Promise<Array<{ result: unknown }>>;
    deliver(integrationId: string): Promise<unknown>;
  };
}

function acceptedProvider(providerPolicyHash: string, provider: "codex" | "claude"): boolean {
  const allowed = workforceProviderForPolicyHash(providerPolicyHash);
  return allowed === "any" || allowed === provider;
}

/**
 * Resolves reviewed policy-seat routes to exact co-resident hired-agent runtimes. A route is an
 * explicit acceptance allowlist; role-name similarity and conversation presence are never used.
 */
export class CoResidentConversationDeliberationParticipants implements ConversationDeliberationParticipantAssignmentPort {
  private readonly endpoints = new Map<string, ParticipantEndpoint>();

  constructor(
    private readonly options: {
      events: Pick<EventStore, "latest" | "list">;
    },
  ) {}

  register(endpoint: ParticipantEndpoint): void {
    const participantId = endpoint.config.agentParticipantId;
    if (
      endpoint.config.deliberationParticipation === undefined ||
      endpoint.participation.agentId === null ||
      endpoint.participation.agentBinding === undefined ||
      endpoint.config.organization === undefined ||
      this.endpoints.has(participantId)
    ) {
      throw new Error("The deliberation participant runtime endpoint is invalid or duplicated.");
    }
    this.endpoints.set(participantId, endpoint);
  }

  attach(input: {
    participantId: string;
    artifacts: ArtifactStore;
    handle(event: ConversationInboundEvent): Promise<Array<{ result: unknown }>>;
    deliver(integrationId: string): Promise<unknown>;
  }): () => void {
    const endpoint = this.endpoints.get(input.participantId);
    if (endpoint === undefined || endpoint.runtime !== undefined) {
      throw new Error("The deliberation participant runtime cannot be attached.");
    }
    endpoint.runtime = {
      artifacts: input.artifacts,
      handle: input.handle,
      deliver: input.deliver,
    };
    return () => {
      if (endpoint.runtime?.artifacts === input.artifacts) delete endpoint.runtime;
    };
  }

  async publish(input: {
    participantId: string;
    projectId: string;
    conversationId: string;
    threadId: string | null;
    replyToEventId: string;
    artifactEventId: string;
    content: string;
    occurredAt: string;
  }): Promise<void> {
    const endpoint = this.endpoints.get(input.participantId);
    if (endpoint?.runtime === undefined) {
      throw new Error("The assigned deliberation participant runtime is unavailable.");
    }
    if (
      !endpoint.config.conversations.some(
        (binding) => binding.conversationId === input.conversationId,
      )
    ) {
      throw new Error("The deliberation publication exceeds the participant conversation scope.");
    }
    const stored = await endpoint.runtime.artifacts.put(input.content);
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey(
        JSON.stringify([
          "deliberation-agent-publication",
          1,
          input.artifactEventId,
          input.participantId,
          input.conversationId,
          input.threadId,
        ]),
      ),
      target: {
        integrationId: endpoint.config.integrationId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        threadId: input.threadId,
      },
      kind: "signal.raised",
      actor: {
        kind: "system",
        participantId: "ptc_lervo_system",
        roleId: null,
        agentBinding: null,
      },
      content: {
        artifactId: `art_${stored.contentHash.slice("sha256:".length, 60)}`,
        contentHash: stored.contentHash,
        byteCount: stored.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      mentions: { roleIds: [], participantIds: [input.participantId] },
      replyToEventId: input.replyToEventId,
      signalCode: "deliberation.artifact.recorded",
      automationDepth: 0,
      occurredAt: input.occurredAt,
    });
    const results = await endpoint.runtime.handle(event);
    const responding = results.filter(
      (result) =>
        typeof result.result === "object" &&
        result.result !== null &&
        "outbound" in result.result &&
        result.result.outbound !== null,
    );
    if (responding.length !== 1) {
      throw new Error("The assigned deliberation participant did not publish exactly once.");
    }
    await endpoint.runtime.deliver(endpoint.config.integrationId);
  }

  preflight(input: { policyId: string; projectId: string; conversationId: string }): {
    participantIds: string[];
  } {
    const assignments = this.assign({
      deliberationId: "dlb_preflight",
      policyId: input.policyId,
      projectId: input.projectId,
      conversationId: input.conversationId,
      acceptedAt: "1970-01-01T00:00:00.000Z",
    });
    return {
      participantIds: [
        ...new Set(assignments.map((assignment) => assignment.participantId)),
      ].sort(),
    };
  }

  assign(input: {
    deliberationId: string;
    policyId: string | null;
    projectId: string;
    conversationId: string | null;
    acceptedAt: string;
  }): DeliberationParticipantAssignment[] {
    const organization = projectAgentOrganizationFromEventSource({
      projectId: input.projectId,
      events: this.options.events,
    });
    if (organization.team === null) {
      throw new Error("Named deliberation participation requires an installed organization team.");
    }
    const team = organization.team;
    const activeBindings = organization.deliberationParticipants.filter(
      (binding) => binding.deliberationId === input.deliberationId && binding.releasedAt === null,
    );
    const candidates = [...this.endpoints.values()].flatMap((endpoint) =>
      endpoint.config.deliberationParticipation!.routes.flatMap((route) => {
        const existing = activeBindings.find(
          (binding) =>
            binding.participantId === endpoint.config.agentParticipantId &&
            binding.agentId === endpoint.participation.agentId &&
            binding.bindingVersion === 2 &&
            binding.policyId === route.policyId &&
            binding.policyRoleId === route.policyRoleId,
        );
        const selected =
          input.policyId === null ? existing !== undefined : route.policyId === input.policyId;
        if (!selected) return [];
        if (endpoint.runtime === undefined) {
          throw new Error("The accepted deliberation participant runtime is unavailable.");
        }
        const agentId = endpoint.participation.agentId!;
        const binding = endpoint.participation.agentBinding!;
        const membership = organization.memberships.find(
          (candidate) =>
            candidate.status === "active" &&
            candidate.agentId === agentId &&
            candidate.roleId === endpoint.participation.roleId &&
            candidate.roleVersion === binding.roleVersion &&
            candidate.roleContractHash === binding.roleContractHash &&
            candidate.roleProfileHash === binding.roleProfileHash,
        );
        const deployment = organization.deployments.find(
          (candidate) =>
            candidate.retiredAt === null &&
            candidate.agentId === agentId &&
            candidate.participantId === endpoint.config.agentParticipantId &&
            candidate.integrationId === endpoint.config.integrationId,
        );
        const channel = organization.channelMemberships.find(
          (candidate) =>
            candidate.status === "active" &&
            (input.conversationId === null
              ? candidate.channelMembershipId === existing?.channelMembershipId
              : candidate.conversationId === input.conversationId) &&
            candidate.participantId === endpoint.config.agentParticipantId &&
            candidate.deploymentId === deployment?.deploymentId,
        );
        if (
          membership === undefined ||
          deployment === undefined ||
          channel === undefined ||
          deployment.membershipId !== membership.membershipId ||
          channel.membershipId !== membership.membershipId
        ) {
          throw new Error("The accepted deliberation participant has no exact active deployment.");
        }
        const provider =
          route.provider ??
          endpoint.config.routing?.response.provider ??
          endpoint.config.command.provider;
        if (!acceptedProvider(membership.providerPolicyHash, provider)) {
          throw new Error("The deliberation execution provider exceeds the hired-agent policy.");
        }
        const model = route.model ?? endpoint.config.routing?.response.model ?? null;
        const reasoningEffort =
          route.reasoningEffort ?? endpoint.config.routing?.response.reasoningEffort ?? null;
        const executionRouteHash = deliberationExecutionRouteHash({
          participantId: endpoint.config.agentParticipantId,
          integrationId: endpoint.config.integrationId,
          provider,
          model,
          reasoningEffort,
        });
        const participationAssignmentId = deliberationParticipationAssignmentId({
          deliberationId: input.deliberationId,
          policyId: route.policyId,
          policyRoleId: route.policyRoleId,
          agentId,
          executionRouteHash,
        });
        if (
          existing !== undefined &&
          (existing.participationAssignmentId !== participationAssignmentId ||
            existing.executionRouteHash !== executionRouteHash)
        ) {
          throw new Error("The resumed deliberation participant execution route changed.");
        }
        return [
          {
            schemaVersion: 1 as const,
            participationAssignmentId,
            deliberationId: input.deliberationId,
            policyId: route.policyId,
            policyRoleId: route.policyRoleId,
            projectId: input.projectId,
            conversationId: channel.conversationId,
            organizationId: team.organizationId,
            teamId: team.teamId,
            channelMembershipId: channel.channelMembershipId,
            membershipId: membership.membershipId,
            deploymentId: deployment.deploymentId,
            agentId,
            participantId: endpoint.config.agentParticipantId,
            agentRoleId: membership.roleId,
            roleVersion: membership.roleVersion,
            roleContractHash: membership.roleContractHash,
            roleProfileHash: membership.roleProfileHash,
            providerPolicyHash: membership.providerPolicyHash,
            provider,
            model,
            reasoningEffort,
            executionRouteHash,
            acceptedAt: existing?.acceptedAt ?? input.acceptedAt,
          },
        ];
      }),
    );
    const assignments = candidates;
    if (input.policyId === null && assignments.length !== activeBindings.length) {
      throw new Error("The resumed deliberation participant runtime is no longer accepted.");
    }
    const coordinates = assignments.map(
      (assignment) => `${assignment.policyId}\0${assignment.policyRoleId}`,
    );
    if (new Set(coordinates).size !== coordinates.length) {
      throw new Error("A deliberation policy seat has multiple accepted agent runtimes.");
    }
    return assignments.sort((left, right) => left.policyRoleId.localeCompare(right.policyRoleId));
  }
}
