import type { AdapterNormalizedEvent, AdapterSession } from "@roven/schemas";

export type CodexApprovalPolicy = "untrusted" | "on-request" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexThreadStartOptions {
  cwd: string;
  model?: string;
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
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
  startTurn(threadId: string, instructions: string): Promise<CodexTurn>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  unsubscribe(threadId: string): Promise<void>;
  notifications(signal: AbortSignal): AsyncIterable<unknown>;
  close(): Promise<void>;
}

export type CodexAppServerClientFactory = () => Promise<CodexAppServerClient>;

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
  activeProviderTurnId?: string;
  eventStreamClaimed: boolean;
  stopped: boolean;
}

export type NormalizedCodexEvent = AdapterNormalizedEvent;

export type CodexAdapterErrorCode =
  | "invalid_request"
  | "session_not_found"
  | "session_mismatch"
  | "session_stopped"
  | "context_materialization_failed"
  | "provider_protocol_failed"
  | "provider_process_failed";

export class CodexAdapterError extends Error {
  constructor(readonly code: CodexAdapterErrorCode, message: string) {
    super(message);
    this.name = "CodexAdapterError";
  }
}
