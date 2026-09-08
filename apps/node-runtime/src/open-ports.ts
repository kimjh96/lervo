import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import type { DiscordGatewayTransport } from "@lervo/discord-gateway";
import type { ConversationResponder } from "@lervo/interaction";
import type {
  AuthenticatedHubTransport,
  OutboundSyncPollingWaitPort,
  SyncCycleResult,
  SyncHttpTransportOptions,
} from "@lervo/sync";

import type { ConversationIntentResolver } from "./conversation-intent-resolver.js";
import type { NodeRemoteCommandPorts } from "./control-runtime.js";

export interface NodeDiscordConversationOpenPorts {
  continuation?: ConversationRemoteContinuationPort;
  readOnlyResponder?: ConversationResponder;
  intentResolver?: ConversationIntentResolver;
  gatewayTransport?: DiscordGatewayTransport;
  fetch?: typeof globalThis.fetch;
  onError?(error: Error): void;
}

export interface NodeRuntimeOpenPorts {
  createTransport?: (options: SyncHttpTransportOptions) => AuthenticatedHubTransport;
  wait?: OutboundSyncPollingWaitPort;
  nowMilliseconds?: () => number;
  onCycle?: (result: SyncCycleResult) => void | Promise<void>;
  remoteCommands?: NodeRemoteCommandPorts;
  discordConversation?: NodeDiscordConversationOpenPorts;
  discordConversations?: Record<string, NodeDiscordConversationOpenPorts>;
}
