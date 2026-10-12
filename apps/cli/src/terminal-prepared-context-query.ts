import type { ProjectStorage } from "@lervo/project-storage";
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import type { UnmanagedTerminalCoordinates } from "./terminal-hook-contract.js";

export function findLatestPreparedContext(
  events: ProjectStorage["events"],
  coordinates: UnmanagedTerminalCoordinates,
  provider: TerminalIntegrationProvider,
) {
  let afterSeq = 0;
  let found: ReturnType<typeof events.list>[number] | null = null;
  while (true) {
    const batch = events.list({ runId: coordinates.runId, afterSeq, limit: 1000 });
    if (batch.length === 0) break;
    for (const event of batch) {
      afterSeq = event.seq;
      if (
        event.type !== "terminal.context.prepared" ||
        event.actor.kind !== "provider" ||
        event.actor.provider !== provider
      )
        continue;
      const payload = event.payload as Record<string, unknown>;
      if (payload.providerSessionDigest !== coordinates.providerSessionDigest) continue;
      if (
        coordinates.providerTurnDigest !== null &&
        payload.providerTurnDigest !== coordinates.providerTurnDigest
      )
        continue;
      found = event;
    }
    if (batch.length < 1000) break;
  }
  return found;
}
