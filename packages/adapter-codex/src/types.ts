import type {
  AdapterCapabilityActivationRequest,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterTurn,
} from "@lervo/schemas";

export type CodexApprovalPolicy = "untrusted" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexThreadStartOptions {
  cwd: string;
  model?: string;
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
}

export interface CodexTurn {
  turnId: string;
}

export interface CodexAppServerClient {
  startThread(options: CodexThreadStartOptions): Promise<CodexThread>;
  injectItems(threadId: string, items: readonly unknown[]): Promise<void>;
  listConnectedMcpServers?(threadId: string): Promise<string[]>;
  startTurn(threadId: string, instructions: string): Promise<CodexTurn>;
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
  approvalPolicy?: CodexApprovalPolicy;
  sandbox?: CodexSandboxMode;
  executable?: string;
  requestTimeoutMs?: number;
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
  turnResults: Map<string, { content: string; producedAt: string }>;
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
