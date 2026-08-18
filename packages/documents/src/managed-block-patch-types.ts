import type {
  ManagedBlockPatchCandidateArtifact,
} from "@lervo/schemas";

import type { ScannedDocumentSource } from "./types.js";

export type ManagedBlockPatchSource = ScannedDocumentSource;

export interface CreateManagedBlockPatchCandidateInput {
  source: ManagedBlockPatchSource;
  blockId: string;
  replacementBytes: Uint8Array;
}

export interface ManagedBlockPatchCandidateResult {
  artifact: ManagedBlockPatchCandidateArtifact;
  candidateBytes: Uint8Array;
  outputBytes: Uint8Array;
}

export type ManagedBlockPatchErrorCode =
  | "block_not_found"
  | "candidate_contract_invalid"
  | "invalid_patch_request"
  | "legacy_marker_not_writable"
  | "no_changes"
  | "output_structure_invalid"
  | "replacement_invalid_utf8"
  | "replacement_too_large"
  | "source_changed"
  | "source_structure_invalid";

export class ManagedBlockPatchError extends Error {
  constructor(
    readonly code: ManagedBlockPatchErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedBlockPatchError";
  }
}
