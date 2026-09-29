import { ManagedContextReferenceError } from "@lervo/adapter-contract";
import type { ContextArtifactPort } from "@lervo/context-delivery";
import { managedResultReferenceSpecs } from "./managed-context-reference.js";
import { ManagedProviderRunError } from "./provider-run-types.js";
import { storeProviderResult } from "./provider-result.js";
import type { ManagedEventSpec } from "./telemetry.js";

/** Preserve an actual validated adapter result when reference projection fails; publication still fails. */
export async function observeManagedResultReferences(
  input: Parameters<typeof managedResultReferenceSpecs>[0],
  artifacts: ContextArtifactPort,
  append: (specs: ManagedEventSpec[]) => void,
) {
  try {
    return managedResultReferenceSpecs(input);
  } catch (error) {
    if (
      !(error instanceof ManagedProviderRunError) ||
      !(error.cause instanceof ManagedContextReferenceError)
    )
      throw error;
    const stored = await storeProviderResult({ result: input.result, artifactStore: artifacts });
    append([
      {
        eventId: input.sourceEventId,
        type: "adapter.result.captured",
        occurredAt: input.result.producedAt,
        actor: { kind: "provider", provider: input.session.provider },
        payload: {
          adapterId: input.session.adapterId,
          providerSessionId: input.session.providerSessionId,
          targetTurnId: input.turn.targetTurnId,
          providerTurnId: input.turn.providerTurnId,
          modelIdentity: structuredClone(input.result.modelIdentity),
          resultDigest: stored.contentHash,
          byteCount: stored.byteCount,
          mediaType: input.result.mediaType,
          referenceTelemetry: "supported",
        },
      },
    ]);
    throw error;
  }
}
