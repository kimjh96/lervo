import type { ArtifactStore } from "@lervo/storage-contract";
import type { EventEnvelope } from "@lervo/schemas";

import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { isProvenAbandonedTurnFailure } from "./supervision-abandoned-turn-failure.js";

/** Settles no run unless the exact terminal and its local proof artifact remain readable. */
export async function readProvenAbandonedTurnFailure(
  events: readonly EventEnvelope[],
  artifacts: ArtifactStore,
): Promise<boolean> {
  const terminal = events.find((event) => event.type === "run.failed");
  if (terminal?.payload.failureCode !== "interrupted_after_turn_start") return false;
  const hash = terminal.payload.diagnosticDigest;
  if (
    terminal.schemaVersion !== 1 ||
    terminal.actor.kind !== "system" ||
    terminal.payload.retryable !== false ||
    typeof hash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(hash) ||
    !(await artifacts.has(`lervo-cas://sha256/${hash.slice(7)}`))
  )
    return false;
  return isProvenAbandonedTurnFailure(events, await readSupervisionJsonArtifact(artifacts, hash));
}
