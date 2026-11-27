import type {
  NoCapabilityJsonInvocationStrategy,
  NoCapabilityJsonProvider,
  NoCapabilityJsonReasoningEffort,
  NoCapabilityJsonUsage,
} from "@lervo/adapter-contract";
import type { ProviderJsonRequest } from "@lervo/repository-knowledge";

export type { ProviderJsonRequest };

/** Capability counters a no-capability provider run must report as zero. */
export interface NoCapabilityTelemetry {
  filesystemReads: number;
  filesystemWrites: number;
  shellProcesses: number;
  networkRequests: number;
  externalActions: number;
  toolCalls: number;
  complete: true;
}

export interface CreateProcessProviderOptions {
  /** The provider adapter's translation of a run; composition chooses it, never this package. */
  strategy: NoCapabilityJsonInvocationStrategy;
  executable?: string;
  environment?: NodeJS.ProcessEnv;
  identityHash?: string;
  beforeCall?: () => Promise<void>;
  onCall?: () => Promise<void>;
  model?: string;
  /** ADR-0612: the role's effort; the JSON runner otherwise uses `low`, as before. */
  reasoningEffort?: NoCapabilityJsonReasoningEffort;
  systemPrompt?: string;
  timeoutMs?: number;
}

export interface NoCapabilityProviderJsonRunner {
  provider: NoCapabilityJsonProvider;
  resolve(input: ProviderJsonRequest, signal?: AbortSignal): Promise<unknown>;
  resolveObserved?(
    input: ProviderJsonRequest,
    signal?: AbortSignal,
  ): Promise<{
    value: unknown;
    usage: ProviderJsonUsage | null;
  }>;
}

export type ProviderJsonUsage = NoCapabilityJsonUsage;
