import type { ContextQualityVerification } from "@lervo/schemas";
import type { RepositoryQualityInput } from "./repository-quality-context.js";
import type { ContextOutcomeInput } from "./context-outcome-types.js";
import type {
  ContextOutcomeCorrectionPorts,
  ContextOutcomeCorrectionResult,
} from "./context-outcome-correction-types.js";
import type { ContextQualityRecording } from "./context-quality-recording.js";

export type HostOutcomeArtifact =
  | { kind: "repository"; path: string; expectedDigest?: string; baselineBytes?: Uint8Array }
  | {
      kind: "immutable";
      artifactId: string;
      contentHash: string;
      byteCount: number;
      readBytes(): Promise<Uint8Array>;
    };
export interface HostOutcomeContract {
  definition: ContextOutcomeInput["definition"];
  isPublication: boolean;
  requirePassed: boolean;
  evaluator?: ContextOutcomeInput["evaluator"];
  taskEvaluator?: ContextOutcomeInput["taskEvaluator"];
  authorizeLanguageException?: ContextOutcomeInput["authorizeLanguageException"];
  correction?: ContextOutcomeCorrectionPorts;
}
export interface HostOutcomePolicy {
  resolve(input: {
    planDigest: string;
    artifact: HostOutcomeArtifact;
    preparation: RepositoryQualityInput;
  }): Promise<HostOutcomeContract>;
  /** An admitted correction invalidates earlier project-suite evidence. Its existing owner reruns
   * those gates before this operation can return a controlled completion. */
  verifyAfterCorrection?: () => Promise<void>;
}
export interface HostContextOutcomeInput {
  repositoryRoot: string;
  origin: RepositoryQualityInput["origin"];
  task: RepositoryQualityInput["task"];
  artifacts: readonly HostOutcomeArtifact[];
  effects: "read_only" | "owner_controlled";
  coordinates?: { runId: string; sessionId: string };
  policy?: HostOutcomePolicy;
}
export interface HostContextOutcomeReport {
  status: "observed" | "unavailable" | "writer_not_active";
  completionAllowed: boolean;
  artifactCount: number;
  observedCount: number;
  reason: "completed" | "writer_not_active" | "capacity" | "observation_unavailable";
  outcomes: {
    artifactIndex: number;
    observation: ContextQualityVerification | null;
    recording: ContextQualityRecording | null;
    correction: ContextOutcomeCorrectionResult | null;
  }[];
}
