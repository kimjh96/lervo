import type { SharedContextPublication } from "@lervo/schemas";

import {
  type ContextHandoffInput,
  ContextPreparationError,
} from "./types.js";

export function indexPublications(
  publications: readonly SharedContextPublication[],
): Map<string, SharedContextPublication> {
  const indexed = new Map<string, SharedContextPublication>();
  for (const publication of publications) {
    if (indexed.has(publication.sharedContextId)) {
      throw new ContextPreparationError(
        "duplicate_shared_context_id",
        `Shared context ID가 중복되었습니다: ${publication.sharedContextId}`,
      );
    }
    indexed.set(publication.sharedContextId, publication);
  }
  return indexed;
}

export function assertUniqueHandoffs(handoffs: readonly ContextHandoffInput[]): void {
  const handoffIds = new Set<string>();
  for (const handoff of handoffs) {
    if (handoffIds.has(handoff.bundle.handoffId)) {
      throw new ContextPreparationError(
        "duplicate_handoff_id",
        `Handoff ID가 중복되었습니다: ${handoff.bundle.handoffId}`,
      );
    }
    handoffIds.add(handoff.bundle.handoffId);
  }
}
