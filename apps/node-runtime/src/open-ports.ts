import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import type { DiscordGatewayTransport } from "@lervo/discord-gateway";
import type {
  AuthenticatedHubTransport,
  OutboundSyncPollingWaitPort,
  SyncCycleResult,
  SyncHttpTransportOptions,
} from "@lervo/sync";

import type { NodeRemoteCommandPorts } from "./control-runtime.js";

export interface NodeRuntimeOpenPorts {
  createTransport?: (options: SyncHttpTransportOptions) => AuthenticatedHubTransport;
  wait?: OutboundSyncPollingWaitPort;
  nowMilliseconds?: () => number;
  onCycle?: (result: SyncCycleResult) => void | Promise<void>;
  remoteCommands?: NodeRemoteCommandPorts;
  discordConversation?: {
    continuation?: ConversationRemoteContinuationPort;
    gatewayTransport?: DiscordGatewayTransport;
    fetch?: typeof globalThis.fetch;
    onError?(error: Error): void;
  };
}
