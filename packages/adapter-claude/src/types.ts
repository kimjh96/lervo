import type { OutputFormat, startup } from "@anthropic-ai/claude-agent-sdk";
import type { AdapterNativeProcessState, ProviderLoginContext } from "@lervo/adapter-contract";
import type {
  AdapterCapabilityActivationRequest,
  AdapterSession,
  AdapterTurn,
} from "@lervo/schemas";
import type { ProviderOutputSchema } from "@lervo/schemas";

export type ClaudePermissionMode = "default" | "plan" | "dontAsk";
export type ClaudeReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

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
  environment?: Record<string, string>;
  providerSessionId: string;
  cwd: string;
  model?: string;
  systemPrompt?: string;
  executable?: string;
  permissionMode: ClaudePermissionMode;
  requestTimeoutMs: number;
  createMessageId: () => string;
  tools?: string[];
  outputFormat?: OutputFormat;
  reasoningEffort?: ClaudeReasoningEffort;
  capabilityActivations?: readonly AdapterCapabilityActivationRequest[];
}

export interface ClaudeAgentClient {
  inspectProcess?(): AdapterNativeProcessState;
  attachToolUseHandler(handler: ClaudeToolUseHandler): void;
  appendContext(content: string): Promise<void>;
  confirmCapabilities?(): Promise<void>;
  startTurn(turnId: string, instructions: string): Promise<void>;
  interrupt(): Promise<void>;
  messages(signal: AbortSignal): AsyncIterable<unknown>;
  close(): Promise<void>;
}

export type ClaudeAgentClientFactory = (
  options: ClaudeAgentClientStartOptions,
) => Promise<ClaudeAgentClient>;

export interface ClaudeAdapterOptions {
  loginContext?: ProviderLoginContext;
  repositoryRoot: string;
  model?: string;
  systemPrompt?: string;
  executable?: string;
  permissionMode?: ClaudePermissionMode;
  requestTimeoutMs?: number;
  tools?: string[];
  /** ADR-0608: only a schema `providerOutputSchema` checked. */
  structuredOutputSchema?: ProviderOutputSchema;
  reasoningEffort?: ClaudeReasoningEffort;
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
  turnResults: Map<
    string,
    Pick<import("@lervo/schemas").AdapterTurnResult, "content" | "producedAt" | "modelIdentity">
  >;
  requestedModel: string | null;
  answerModels: Map<string, Set<string>>;
  managedWrites?: ClaudeManagedWriteHandler;
  activeTurn?: AdapterTurn;
  activeProviderTurnId?: string;
  eventStreamClaimed: boolean;
  capabilityActivations: AdapterCapabilityActivationRequest[];
  activationConfirmed: boolean;
}

export type ClaudeAdapterErrorCode =
  | "invalid_request"
  | "session_not_found"
  | "session_mismatch"
  | "session_stopped"
  | "context_materialization_failed"
  | "capability_activation_failed"
  | "provider_protocol_failed"
  | "provider_process_failed";

export class ClaudeAdapterError extends Error {
  constructor(
    readonly code: ClaudeAdapterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClaudeAdapterError";
  }
}
