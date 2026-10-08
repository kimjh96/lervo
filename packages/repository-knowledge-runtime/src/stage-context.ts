import type { ProjectStorage } from "@lervo/project-storage";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

export interface ConvergenceRuntimeContext {
  storage: ProjectStorage;
  settlementAuthority?: {
    obligationId: string;
    snapshotHash: string;
    files: { path: string; contentHash: string }[];
  };
  provider: "codex" | "claude";
  executable?: string;
  admissionDirectory?: string;
  signal: AbortSignal;
  liveWorkPending(): Promise<boolean>;
  assertSource(state: KnowledgeConvergenceInput): void;
  /** Shared by stage adapters; completed shards resume through their exact cache next turn. */
  providerQuantum?: { remaining: number };
}
