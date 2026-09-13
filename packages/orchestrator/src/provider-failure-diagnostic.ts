import { canonicalJson } from "@lervo/event-contract";
import type { ContextArtifactPort } from "@lervo/context-delivery";
import { digest } from "./provider-run-events.js";
import type { RunFailureLedger } from "./provider-run-failures.js";
import { ManagedProviderRunError } from "./provider-run-types.js";

/** Makes the existing diagnostic digest inspectable without persisting provider error text. */
export async function persistProviderFailureDiagnostic(
  artifacts: ContextArtifactPort,
  failures: ReturnType<RunFailureLedger["details"]>,
): Promise<void> {
  const content = canonicalJson({ failures });
  if (failures.length === 0 || failures.length > 64 || Buffer.byteLength(content) > 16384)
    throw new ManagedProviderRunError(
      "artifact_storage_failed",
      "The failure diagnostic exceeds its bound.",
    );
  const stored = await artifacts.put(new TextEncoder().encode(content));
  if (
    stored.contentHash !== digest({ failures }) ||
    new TextDecoder("utf-8", { fatal: true }).decode(await artifacts.get(stored.uri)) !== content
  )
    throw new ManagedProviderRunError(
      "artifact_storage_failed",
      "The stored failure diagnostic differs from its ledger.",
    );
}
