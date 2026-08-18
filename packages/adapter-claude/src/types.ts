import type { startup } from "@anthropic-ai/claude-agent-sdk";
import type { AdapterManagedWriteRequest, AdapterSession, AdapterTurn } from "@roven/schemas";
import type { ProviderManagedWriteBridge } from "@roven/adapter-contract";

export type ClaudePermissionMode = "default" | "plan" | "dontAsk";

export interface ClaudeToolUseHandler {
  authorize(toolName: string, input: unknown, toolUseId: string): Promise<boolean>;
  complete(
    toolName: string,
    input: unknown,
    toolUseId: string,
    status: "completed" | "failed",
  ): Promise<void>;
}

export interface ClaudeAgentClientStartOptions {
  providerSessionId: string;
  cwd: string;
  model?: string;
  executable?: string;
  permissionMode: ClaudePermissionMode;
  requestTimeoutMs: number;
  createMessageId: () => string;
  tools?: string[];
}

export interface ClaudeAgentClient {
  attachToolUseHandler(handler: ClaudeToolUseHandler): void;
  appendContext(content: string): Promise<void>;
  startTurn(turnId: string, instructions: string): Promise<void>;
  interrupt(): Promise<void>;
  messages(signal: AbortSignal): AsyncIterable<unknown>;
  close(): Promise<void>;
}

export type ClaudeAgentClientFactory = (
  options: ClaudeAgentClientStartOptions,
) => Promise<ClaudeAgentClient>;

export interface ClaudeAdapterOptions {
  repositoryRoot: string;
  model?: string;
  executable?: string;
  permissionMode?: ClaudePermissionMode;
  requestTimeoutMs?: number;
  tools?: string[];
  clientFactory?: ClaudeAgentClientFactory;
  sdkStartup?: typeof startup;
  resolveArtifact?: (uri: string) => Promise<Uint8Array>;
  now?: () => Date;
  createEventId?: () => string;
  createReceiptId?: () => string;
  createProviderSessionId?: () => string;
  createProviderMessageId?: () => string;
}

export interface ClaudeSessionState {
  session: AdapterSession;
  client: ClaudeAgentClient;
  injectedTargetTurnIds: Set<string>;
  startedTargetTurnIds: Set<string>;
  turnResults: Map<string, { content: string; producedAt: string }>;
  managedWriteBridge?: ProviderManagedWriteBridge;
  activeTurn?: AdapterTurn;
  approvedWrites: Map<string, AdapterManagedWriteRequest>;
  activeProviderTurnId?: string;
  eventStreamClaimed: boolean;
  stopped: boolean;
}

export type ClaudeAdapterErrorCode =
  | "invalid_request"
  | "session_not_found"
  | "session_mismatch"
  | "session_stopped"
  | "context_materialization_failed"
  | "provider_protocol_failed"
  | "provider_process_failed";

export class ClaudeAdapterError extends Error {
  constructor(readonly code: ClaudeAdapterErrorCode, message: string) {
    super(message);
    this.name = "ClaudeAdapterError";
  }
}
