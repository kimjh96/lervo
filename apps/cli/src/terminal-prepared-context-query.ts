import type { ProjectStorage } from "@lervo/project-storage";
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import type { UnmanagedTerminalCoordinates } from "./terminal-hook-contract.js";
import { sessionOpenTerminalTurn } from "./terminal-open-turns.js";

type TerminalEvent = ReturnType<ProjectStorage["events"]["list"]>[number];

const PREPARED_TYPES = ["terminal.context.prepared"] as const;

function preparedContextMatches(
  event: TerminalEvent,
  coordinates: UnmanagedTerminalCoordinates,
  provider: TerminalIntegrationProvider,
): boolean {
  if (
    event.type !== PREPARED_TYPES[0] ||
    event.runId !== coordinates.runId ||
    event.actor.kind !== "provider" ||
    event.actor.provider !== provider
  )
    return false;
  const payload = event.payload as Record<string, unknown>;
  if (payload.providerSessionDigest !== coordinates.providerSessionDigest) return false;
  return (
    coordinates.providerTurnDigest === null ||
    payload.providerTurnDigest === coordinates.providerTurnDigest
  );
}

/**
 * The latest prepared context of this provider turn. `hintEventId`, the session's open-turn marker,
 * names the context the prompt hook recorded last; when it matches, only later prepared events of
 * the run are read, so a Stop no longer reads the whole session's history. A missing, stale, or
 * mismatched hint reads every prepared event of the run, which gives the same answer.
 */
export function findLatestPreparedContext(
  events: ProjectStorage["events"],
  coordinates: UnmanagedTerminalCoordinates,
  provider: TerminalIntegrationProvider,
  hintEventId: string | null = null,
) {
  let afterSeq = 0;
  let found: TerminalEvent | null = null;
  const hinted = hintEventId === null ? null : events.get(hintEventId);
  if (hinted !== null && preparedContextMatches(hinted, coordinates, provider)) {
    found = hinted;
    afterSeq = hinted.seq;
  }
  while (true) {
    const batch = events.list({
      runId: coordinates.runId,
      afterSeq,
      limit: 1000,
      types: PREPARED_TYPES,
    });
    for (const event of batch) {
      afterSeq = event.seq;
      if (preparedContextMatches(event, coordinates, provider)) found = event;
    }
    if (batch.length < 1000) break;
  }
  return found;
}

/**
 * The session's open-turn marker as a lookup hint; an unreadable marker gives no hint. `now` is the
 * hook's own time, so marker expiry agrees with the Stop that reads the marker again.
 */
export async function preparedContextHint(
  root: string,
  coordinates: UnmanagedTerminalCoordinates,
  now?: Date,
): Promise<string | null> {
  return (
    (await sessionOpenTerminalTurn(root, coordinates.providerSessionDigest, now).catch(() => null))
      ?.contextEventId ?? null
  );
}
