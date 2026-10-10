import type { ContextOutcomeDefinition } from "./context-outcome-types.js";
import type { ContextQualityVerification } from "@lervo/schemas";
import type { ArtifactEditableRange, ArtifactCorrectionEdit } from "@lervo/verification";

export interface ContextOutcomeCorrectionPorts {
  maximumAttempts: number;
  deadlineMs: number;
  signal?: AbortSignal;
  editable: { artifactDigest: string; ranges: ArtifactEditableRange[] };
  propose(input: {
    definition: ContextOutcomeDefinition;
    content: string;
    artifactDigest: string;
    planDigest: string;
    verificationDefinitionHash: string;
    observation: ContextQualityVerification;
    attempt: number;
    signal: AbortSignal;
  }): Promise<ArtifactCorrectionEdit[]>;
  /** The existing effect owner checks current authority (including user-owned bytes), obtains its
   * write fence, calls assertCurrent inside that fence, and atomically compares/replaces exact bytes.
   * It must check cancellation immediately before committing and return a truthful disposition. */
  apply(input: {
    artifactPath: string;
    beforeDigest: string;
    afterDigest: string;
    bytes: Uint8Array;
    planDigest: string;
    verificationDefinitionHash: string;
    signal: AbortSignal;
    assertCurrent(): Promise<void>;
  }): Promise<"applied" | "denied" | "conflict">;
}
export interface ContextOutcomeCorrectionResult {
  status: "unchanged" | "corrected" | "unavailable" | "rejected" | "exhausted" | "cancelled";
  reason:
    | "already_passed"
    | "verification_unavailable"
    | "not_applicable"
    | "no_task_definition"
    | "scope_stale"
    | "proposal_invalid"
    | "protected_material_changed"
    | "authority_denied"
    | "artifact_conflict"
    | "attempts_exhausted"
    | "deadline"
    | "cancelled"
    | "effect_unavailable"
    | "final_verification_failed"
    | "corrected";
  attempts: number;
  applied: boolean | null;
  observation: ContextQualityVerification | null;
  candidateObservations: ContextQualityVerification[];
}
