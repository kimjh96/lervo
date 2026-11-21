import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  requestKnowledgeResidentCycle,
  dismissHeldCapture,
  listQueuedInstructionCaptures,
  instructionCandidateApplyAuthority,
  readInstructionCandidateExchangeState,
  readInstructionCaptureState,
} from "@lervo/repository-knowledge-runtime";

import type { CliIo } from "./types.js";

/**
 * `lervo knowledge instruction capture`: the ADR-0467 capture status (queue depth, budget
 * windows, held Lervo debt) and `--dismiss <capture-id>` to clear a held item once Lervo has
 * documented the decision or the rejected rule is moot (ADR-0561). It never prints queued turn text.
 */
export async function runKnowledgeInstructionCapture(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { root: { type: "string" }, dismiss: { type: "string" }, json: { type: "boolean" } },
  });
  const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
  const now = new Date();
  if (parsed.values.dismiss !== undefined) {
    if (!/^kcap_[a-f0-9]{24}$/u.test(parsed.values.dismiss))
      throw new Error("--dismiss requires a capture ID (kcap_...).");
    const dismissed = await dismissHeldCapture(repositoryRoot, parsed.values.dismiss, now);
    // ADR-0606: a dismissal changes capture state no event records.
    if (dismissed) await requestKnowledgeResidentCycle(repositoryRoot);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ schemaVersion: 1, captureId: parsed.values.dismiss, dismissed })}\n`
        : dismissed
          ? `Dismissed held capture ${parsed.values.dismiss}.\n`
          : `No held capture ${parsed.values.dismiss} exists.\n`,
    );
    return dismissed ? 0 : 1;
  }
  const [queue, state, authority, exchange] = await Promise.all([
    listQueuedInstructionCaptures(repositoryRoot),
    readInstructionCaptureState(repositoryRoot),
    instructionCandidateApplyAuthority(repositoryRoot),
    readInstructionCandidateExchangeState(repositoryRoot),
  ]);
  // ADR-0467: every host assesses its own turns; only the convergence owner applies candidates.
  const report = {
    schemaVersion: 1 as const,
    queuedCount: queue.length,
    applyAuthority: authority,
    authorityBlocked: state.authorityBlocked ?? null,
    exchange: {
      knownCount: exchange.known.length,
      resolvedCount: exchange.resolved.length,
      pendingResolutionCount: exchange.pendingResolutions.length,
    },
    queued: queue.map((capture) => ({
      captureId: capture.captureId,
      source: capture.source,
      promptDigest: capture.promptDigest,
      enqueuedAt: capture.enqueuedAt,
      attempts: capture.attempts,
      retained: capture.retained === true,
    })),
    budget: state.budget,
    lastCycleAt: state.lastCycleAt,
    held: state.held,
  };
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : [
          `Owner-turn capture: ${queue.length} queued for assessment; last cycle ${state.lastCycleAt ?? "never"}.`,
          ...(authority.status === "owner_elsewhere"
            ? [
                `Candidates are applied on the convergence owner host${authority.holderLabel === null ? "" : ` (${authority.holderLabel})`}; this host assesses its own turns and shares candidates through the Hub.`,
              ]
            : []),
          ...(state.authorityBlocked === undefined || state.authorityBlocked === null
            ? []
            : [
                `Assessment is blocked: this host has no knowledge convergence delegation (${state.authorityBlocked.queuedCount} queued since ${state.authorityBlocked.since}).`,
              ]),
          `budget: ${state.budget.assessmentsThisHour} this hour, ${state.budget.assessmentsToday} today, ${state.budget.tokensToday} tokens today`,
          ...(state.held.length === 0
            ? ["No held decisions or rules."]
            : state.held.map(
                (entry) =>
                  `${entry.kind} ${entry.captureId} (${entry.source}, ${entry.capturedAt})\n  ${entry.title}\n  ${entry.statement}`,
              )),
          "",
        ].join("\n"),
  );
  return 0;
}
