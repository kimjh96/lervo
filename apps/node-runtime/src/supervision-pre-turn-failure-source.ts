import type { ArtifactStore } from "@lervo/storage-contract";
import type { EventEnvelope } from "@lervo/schemas";

import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { isProvenPreTurnFailure } from "./supervision-pre-turn-failure.js";

/** Releases no reservation unless the exact terminal and local proof artifact remain readable. */
export async function readProvenPreTurnFailure(
  events: readonly EventEnvelope[],
  artifacts: ArtifactStore,
): Promise<boolean> {
  const terminal = events.find((event) => event.type === "run.failed");
  if (terminal?.payload.failureCode !== "interrupted_before_turn") return false;
  const hash = terminal.payload.diagnosticDigest;
  if (
    terminal.schemaVersion !== 1 ||
    terminal.actor.kind !== "system" ||
    terminal.payload.retryable !== true ||
    typeof hash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(hash) ||
    !(await artifacts.has(`lervo-cas://sha256/${hash.slice(7)}`))
  )
    return false;
  return isProvenPreTurnFailure(events, await readSupervisionJsonArtifact(artifacts, hash));
}
