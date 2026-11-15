import type { ProjectStorage } from "@lervo/project-storage";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

import type { ConvergenceSourceObservation } from "./source-observation.js";

export interface ConvergenceRuntimeContext {
  storage: ProjectStorage;
  settlementAuthority?: {
    obligationId: string;
    snapshotHash: string;
    files: { path: string; contentHash: string }[];
  };
  provider: "codex" | "claude";
  executable?: string;
  providerCliIdentityHash?: string;
  providerCliIdentity?: import("./provider-cli-identity.js").ProviderCliIdentity;
  admissionDirectory?: string;
  signal: AbortSignal;
  liveWorkPending(): Promise<boolean>;
  /** Fences an effect: a complete capture taken now must equal the state's snapshot. */
  assertSourceExact(state: KnowledgeConvergenceInput): void;
  /** Guards a decision; an answer from a validated observation never authorizes an effect. */
  assertSourceCurrent(state: KnowledgeConvergenceInput): void;
  /** Absent, every observation is a complete capture. */
  sourceObservation?: ConvergenceSourceObservation;
  /** Shared by stage adapters; completed shards resume through their exact cache next turn. */
  providerQuantum?: { remaining: number };
}
