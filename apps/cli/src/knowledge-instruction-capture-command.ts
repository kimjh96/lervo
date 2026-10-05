import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  dismissHeldCapture,
  listQueuedInstructionCaptures,
  readConvergenceOwnerFence,
  readInstructionCaptureState,
} from "@lervo/repository-knowledge-runtime";

import type { CliIo } from "./types.js";

/**
 * `lervo knowledge instruction capture`: the ADR-0467 capture status (queue depth, budget
 * windows, held decisions and rules) and `--dismiss <capture-id>` for a held item the owner has
 * documented or declined. It never prints queued turn text.
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
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ schemaVersion: 1, captureId: parsed.values.dismiss, dismissed })}\n`
        : dismissed
          ? `Dismissed held capture ${parsed.values.dismiss}.\n`
          : `No held capture ${parsed.values.dismiss} exists.\n`,
    );
    return dismissed ? 0 : 1;
  }
  const [queue, state, fence] = await Promise.all([
    listQueuedInstructionCaptures(repositoryRoot),
    readInstructionCaptureState(repositoryRoot),
    readConvergenceOwnerFence(repositoryRoot),
  ]);
  // ADR-0466: only the convergence owner assesses; null means a single-host repository.
  const ownerRole = fence?.verdict.role ?? null;
  const report = {
    schemaVersion: 1 as const,
    queuedCount: queue.length,
    convergenceOwnerRole: ownerRole,
    queued: queue.map((capture) => ({
      captureId: capture.captureId,
      source: capture.source,
      promptDigest: capture.promptDigest,
      enqueuedAt: capture.enqueuedAt,
      attempts: capture.attempts,
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
          ...(ownerRole === null || ownerRole === "owner"
            ? []
            : [
                `This host does not own knowledge convergence (${ownerRole}); queued turns are held here until it does, for at most seven days.`,
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
