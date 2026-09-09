import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import type { DiscordGatewayTransport } from "@lervo/discord-gateway";
import type { ConversationResponder } from "@lervo/interaction";
import type { RemoteCommandDeliveryAcknowledgement, RemoteCommandLease } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

import type { ManagedConversationRepositoryResources } from "./conversation-read-responder.js";
import type { ConversationIntentResolver } from "./conversation-intent-resolver.js";
import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import type { DiscordPeerAgentBinding } from "./discord-conversation-composition.js";
import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";

export interface NodeDiscordConversationRuntime {
  readonly failed: Promise<void>;
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
  dataDirectory: string;
  bearerToken(): string;
  continuation?: ConversationRemoteContinuationPort;
  readOnlyResponder?: ConversationResponder;
  intentResolver?: ConversationIntentResolver;
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
  managedRepositoryResources?: ManagedConversationRepositoryResources;
  agentParticipation?: DiscordAgentParticipation;
  peerAgents?: DiscordPeerAgentBinding[];
  gatewayTransport?: DiscordGatewayTransport;
  repositoryEvents?: Pick<EventStore, "latest" | "list">;
  fetch?: typeof globalThis.fetch;
  onError?(error: Error): void;
  onReady(): void | Promise<void>;
  onFailure(code: string): void | Promise<void>;
}
