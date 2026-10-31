import type { KnowledgeProviderAvailabilityError } from "@lervo/repository-knowledge-compiler";
import { pauseKnowledgeProvider } from "./provider-admission.js";

/** Every ordinary background caller records the same native provider pause. */
export function pauseKnowledgeProviderFailure(
  context: { provider: "codex" | "claude"; admissionDirectory?: string },
  error: KnowledgeProviderAvailabilityError,
): Promise<void> {
  return pauseKnowledgeProvider({
    provider: context.provider,
    reason: error.reason,
    observationHash: error.observationHash,
    resetAt: error.resetAt,
    ...(context.admissionDirectory === undefined ? {} : { directory: context.admissionDirectory }),
  });
}
