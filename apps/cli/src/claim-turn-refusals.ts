// The refusals a session's turn already recorded (Lervo ADE coordination, "One event per turn"):
// Lervo records at most one `assignment.claim.refused` per session, holder, and path in a turn.
import type { RecordedClaimRefusal } from "@lervo/agent-workforce";
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import { CLAIM_UNVERIFIED } from "./claim-contract.js";
import { ClaimLog, type ClaimLogEntry } from "./claim-log.js";
import { terminalProviderSessionDigest } from "./terminal-event-coordinates.js";
import { sessionOpenTerminalTurn } from "./terminal-open-turns.js";

/** Each path of `entries` with its holder's agent, as a recorded refusal. */
export function recordedRefusalsOf(entries: readonly ClaimLogEntry[]): RecordedClaimRefusal[] {
  // An unverified refusal recorded no event, so it never stands for one (ADR-0652).
  return entries.flatMap((entry) =>
    entry.code === CLAIM_UNVERIFIED
      ? []
      : entry.paths.map((path) => ({ path, holderAgentId: entry.holder?.agentId ?? null })),
  );
}

/**
 * The refusals this session's turn already recorded, from the claim log since its prompt. Without
 * an open turn or a readable log there is nothing to skip, and every refusal records its event.
 */
export async function turnRefusals(
  repositoryRoot: string,
  provider: TerminalIntegrationProvider,
  providerSessionId: string,
): Promise<RecordedClaimRefusal[]> {
  const turn = await sessionOpenTerminalTurn(
    repositoryRoot,
    terminalProviderSessionDigest(provider, providerSessionId),
  ).catch(() => null);
  if (turn === null) return [];
  let log: ClaimLog | null;
  try {
    log = ClaimLog.openExisting();
  } catch {
    return [];
  }
  if (log === null) return [];
  try {
    return recordedRefusalsOf(log.refusedSince(providerSessionId, turn.openedAt));
  } catch {
    return [];
  } finally {
    log.close();
  }
}
