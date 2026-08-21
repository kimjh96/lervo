import {
  validateManagedProviderRunEvidence,
  type ManagedProviderRunResult,
} from "@lervo/execution-contract";
import type {
  DeliberationArtifact,
  EventEnvelope,
  SharedContextPublication,
} from "@lervo/schemas";

import { DeliberationRuntimeError } from "./types.js";

export interface DeliberationContextEvidenceBinding {
  contextGeneration: number;
  loadedReceiptIds: string[];
  injectedReceiptIds: string[];
  sharedContextIds: string[];
  evidenceEventIds: string[];
}

export function validateManagedRunContextEvidence(input: {
  run: ManagedProviderRunResult;
  events: readonly EventEnvelope[];
  previousArtifacts: readonly DeliberationArtifact[];
  sharedContextPublications: readonly SharedContextPublication[];
}): DeliberationContextEvidenceBinding {
  let binding;
  try {
    binding = validateManagedProviderRunEvidence({
      run: input.run,
      events: input.events,
      sharedContextPublications: input.sharedContextPublications,
    });
  } catch (error) {
    throw new DeliberationRuntimeError(
      "context_evidence_invalid",
      "receipt_event_mismatch",
      "Managed run의 E2/E3 또는 완료 증거가 원본 event와 다릅니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  for (const previous of input.previousArtifacts) {
    const publication = input.sharedContextPublications.find((candidate) =>
      candidate.projectId === previous.projectId &&
      candidate.contentHash === previous.content.contentHash &&
      candidate.producer.kind === "agent" &&
      candidate.producer.roleId === previous.producer.roleId &&
      candidate.producer.runId === previous.producer.runId &&
      candidate.producer.sessionId === previous.producer.sessionId,
    );
    if (publication === undefined) {
      throw new DeliberationRuntimeError(
        "context_evidence_invalid",
        "previous_artifact_not_loaded",
        "이전 숙의 artifact가 shared context로 다시 적재되지 않았습니다.",
      );
    }
  }
  return binding;
}
