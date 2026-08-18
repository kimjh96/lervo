import type { startup } from "@anthropic-ai/claude-agent-sdk";
import type { AdapterSession, AdapterTurn } from "@lervo/schemas";

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

export interface ClaudeManagedWriteHandler extends ClaudeToolUseHandler {
  clear(): void;
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
  managedWrites?: ClaudeManagedWriteHandler;
  activeTurn?: AdapterTurn;
  activeProviderTurnId?: string;
  eventStreamClaimed: boolean;
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
