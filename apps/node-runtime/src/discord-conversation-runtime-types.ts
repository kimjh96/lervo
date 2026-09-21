import type { ConversationAdapter } from "@lervo/conversation-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import type { DiscordGatewayTransport } from "@lervo/discord-gateway";
import type { ConversationResponder } from "@lervo/interaction";
import type { RepositoryWorkTurnExecutor } from "@lervo/adapter-contract";
import type { RemoteCommandDeliveryAcknowledgement, RemoteCommandLease } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

import type { ManagedConversationRepositoryResources } from "./conversation-read-responder.js";
import type { ConversationIntentResolver } from "./conversation-intent-resolver.js";
import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import type {
  NodeDiscordConversationConfig,
  NodeRepositoryWorkExecutionProfile,
  NodeRepositoryWorkExecutionProfilePolicy,
  NodeRuntimeConfig,
} from "./config-types.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { NodeSupervisionStartupConfiguration } from "./supervision-startup-config.js";
import type { ConversationTurnFocusStore } from "./conversation-turn-focus-store.js";
import type { CoResidentConversationPeerTurnRouter } from "./conversation-peer-turn-router.js";
import type { ConversationDeliberationParticipantAssignmentPort } from "./conversation-deliberation-participant-router.js";
import type { ConversationRequestedRuntimeProcessPort } from "./conversation-requested-runtime.js";

export interface NodeDiscordConversationRuntime {
  readonly failed: Promise<void>;
  resultAdapter?(integrationId: string): ConversationAdapter | null;
  resultArtifacts?(integrationId: string): ArtifactStore | null;
  resultReplay?(
    integrationId: string,
    outboundId: string,
  ): "absent" | "sending" | "unknown" | "rejected" | "delivered" | null;
  observeRemoteAcknowledgement(input: {
    lease: RemoteCommandLease;
    acknowledgement: RemoteCommandDeliveryAcknowledgement;
  }): Promise<"ready" | "duplicate" | "ignored">;
  runResultDeliveryCycle(): Promise<void>;
  stopIngress(): void;
  close(): void | Promise<void>;
}

export interface NodeDiscordConversationRuntimeOptions {
  config: NodeDiscordConversationConfig;
  hub: NodeRuntimeConfig["hub"];
  project: {
    projectId: string;
    projectIdentityHash: string;
    createdAt: string;
  };
  repositoryRoot: string;
  repositoryReplica?: NodeRuntimeConfig["repositoryReplica"];
  outcomeSupervision?: NodeSupervisionStartupConfiguration;
  /** Standing supervision only: lets the goal intake hand the runtime its next lineage binding. */
  supervisionControl?: { onRebound(binding: NodeSupervisionBinding): Promise<void> };
  dataDirectory: string;
  runtimeConfigPath?: string;
  bearerToken(): string;
  continuation?: ConversationRemoteContinuationPort;
  readOnlyResponder?: ConversationResponder;
  intentResolver?: ConversationIntentResolver;
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
  providerModels?: Partial<Record<"codex" | "claude", string>>;
  providerReasoningEfforts?: Partial<
    Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">
  >;
  providerExecutionProfiles?: Record<
    NodeRepositoryWorkExecutionProfile,
    NodeRepositoryWorkExecutionProfilePolicy
  >;
  repositoryWorkExecutor?: RepositoryWorkTurnExecutor;
  managedRepositoryResources?: ManagedConversationRepositoryResources;
  agentParticipation?: DiscordAgentParticipation;
  peerAgents?: DiscordPeerAgentBinding[];
  peerTurnRouter?: CoResidentConversationPeerTurnRouter;
  deliberationParticipants?: ConversationDeliberationParticipantAssignmentPort;
  unaddressedPriorities?: ReadonlyMap<string, number>;
  turnFocusStore?: ConversationTurnFocusStore;
  gatewayTransport?: DiscordGatewayTransport;
  repositoryArtifactStore?: ArtifactStore;
  repositoryEvents?: Pick<EventStore, "latest" | "list"> & { readonly path?: string };
  fetch?: typeof globalThis.fetch;
  requestedRuntimeProcesses?: ConversationRequestedRuntimeProcessPort;
  onError?(error: Error): void;
  onReady(): void | Promise<void>;
  onFailure(code: string): void | Promise<void>;
}
