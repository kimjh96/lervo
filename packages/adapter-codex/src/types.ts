import type {
  AdapterCapabilityActivationRequest,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterTurn,
} from "@lervo/schemas";
import type { AdapterNativeProcessState } from "@lervo/adapter-contract";

export type CodexApprovalPolicy = "untrusted" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type CodexTransportOptions =
  | { kind: "app_server" }
  | {
      kind: "responses_api_no_tools";
      apiKey?: string;
      model?: string;
      fetch?: typeof globalThis.fetch;
    };

export interface CodexThreadStartOptions {
  cwd: string;
  model?: string;
  baseInstructions?: string;
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  config?: Record<string, unknown>;
  selectedCapabilityRoots?: Array<{
    id: string;
    location: { type: "environment"; environmentId: string; path: string };
  }>;
}

export interface CodexThread {
  threadId: string;
  model?: string | null;
}

export interface CodexTurn {
  turnId: string;
}

export interface CodexTurnStartOptions {
  outputSchema?: Record<string, unknown>;
  reasoningEffort?: CodexReasoningEffort;
}

export interface CodexAppServerClient {
  readonly toolBoundary?: "no_tools";
  inspectProcess?(): AdapterNativeProcessState;
  startThread(options: CodexThreadStartOptions): Promise<CodexThread>;
  injectItems(threadId: string, items: readonly unknown[]): Promise<void>;
  listConnectedMcpServers?(threadId: string): Promise<string[]>;
  startTurn(
    threadId: string,
    instructions: string,
    options?: CodexTurnStartOptions,
  ): Promise<CodexTurn>;
  respondFileChangeApproval(
    requestId: string | number,
    decision: "accept" | "decline",
  ): Promise<void>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  unsubscribe(threadId: string): Promise<void>;
  notifications(signal: AbortSignal): AsyncIterable<unknown>;
  close(): Promise<void>;
}

export type CodexAppServerClientFactory = () => Promise<CodexAppServerClient>;

export interface CodexManagedWriteHandler {
  handle(raw: unknown, activeTurn: AdapterTurn | undefined): Promise<boolean>;
  clear(): void;
}

export interface CodexAdapterOptions {
  repositoryRoot: string;
  model?: string;
  baseInstructions?: string;
  transport?: CodexTransportOptions;
  approvalPolicy?: CodexApprovalPolicy;
  sandbox?: CodexSandboxMode;
  executable?: string;
  requestTimeoutMs?: number;
  structuredOutputSchema?: Record<string, unknown>;
  reasoningEffort?: CodexReasoningEffort;
  clientFactory?: CodexAppServerClientFactory;
  resolveArtifact?: (uri: string) => Promise<Uint8Array>;
  now?: () => Date;
  createEventId?: () => string;
  createReceiptId?: () => string;
}

export interface CodexSessionState {
  session: AdapterSession;
  client: CodexAppServerClient;
  injectedTargetTurnIds: Set<string>;
  startedTargetTurnIds: Set<string>;
  turnResults: Map<
    string,
    Pick<import("@lervo/schemas").AdapterTurnResult, "content" | "producedAt" | "modelIdentity">
  >;
  requestedModel: string | null;
  sessionObservedModel: string | null;
  managedWrites?: CodexManagedWriteHandler;
  activeTurn?: AdapterTurn;
  activeProviderTurnId?: string;
  eventStreamClaimed: boolean;
  capabilityActivations: AdapterCapabilityActivationRequest[];
  activationConfirmed: boolean;
}

export type NormalizedCodexEvent = AdapterNormalizedEvent;

export type CodexAdapterErrorCode =
  | "invalid_request"
  | "session_not_found"
  | "session_mismatch"
  | "session_stopped"
  | "context_materialization_failed"
  | "capability_activation_failed"
  | "provider_protocol_failed"
  | "provider_process_failed";

export class CodexAdapterError extends Error {
  constructor(
    readonly code: CodexAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CodexAdapterError";
  }
}
