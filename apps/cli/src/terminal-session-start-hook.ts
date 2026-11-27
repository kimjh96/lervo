// A provider `SessionStart` (ADR-0562 section 4): the epoch's base block, the conversation a
// hosted agent works in, and the settlement of a resumed session's turn that no `Stop` closed.
import { turnEndingEventSchemaVersion } from "@lervo/event-contract";
import { inspectEventWriterCoordinate } from "@lervo/project";
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import { roomBlock } from "./room-context.js";
import { terminalProviderSessionDigest } from "./terminal-event-coordinates.js";
import { TERMINAL_HOOK_BUDGET_MS, withinTerminalDeadline } from "./terminal-hook-budget.js";
import type { ParsedSessionStartInput } from "./terminal-hook-contract.js";
import { resolveTerminalRoots } from "./terminal-roots.js";
import { prepareTerminalSessionStart } from "./terminal-session-start.js";
import { requestOpenTerminalTurnSettlement } from "./terminal-turn-settlement.js";
import { launchTerminalTurnSettlements } from "./terminal-turn-settlement-lease.js";
import type { CliIo } from "./types.js";

/**
 * At a session start, requests the settlement of the session's turn that no Stop closed, with
 * the checkout's snapshot taken when the worker runs, and starts the worker for every pending
 * request. Below writer schema 12 nothing can be recorded, so no request is written.
 */
async function settleOnSessionStart(
  cwd: string,
  provider: TerminalIntegrationProvider,
  input: { providerSessionId: string },
): Promise<boolean> {
  const { evidenceRoot, executionRoot } = await resolveTerminalRoots(cwd);
  const writer = (await inspectEventWriterCoordinate(evidenceRoot)).coordinate
    .selectedEventSchemaVersion;
  if (writer >= turnEndingEventSchemaVersion)
    await requestOpenTerminalTurnSettlement({
      root: evidenceRoot,
      executionRoot,
      provider,
      providerSessionDigest: terminalProviderSessionDigest(provider, input.providerSessionId),
      ending: "session_start",
      afterObservationId: null,
      transcriptEnd: null,
      now: new Date(),
    });
  return launchTerminalTurnSettlements(evidenceRoot, executionRoot);
}

/**
 * ADR-0562 section 4: the epoch's base block at a session start. Without it the next prompt still
 * delivers the full context, so a failure answers with nothing instead of blocking the session.
 */
export async function answerSessionStart(
  io: CliIo,
  provider: TerminalIntegrationProvider,
  input: ParsedSessionStartInput,
  startedAt: number,
): Promise<void> {
  const additionalContext = await withinTerminalDeadline(
    startedAt + TERMINAL_HOOK_BUDGET_MS,
    async () =>
      prepareTerminalSessionStart({
        // The base block, its rules, and the session's epoch belong to the repository.
        ...(await resolveTerminalRoots(io.cwd).then(({ evidenceRoot, executionRoot }) => ({
          root: evidenceRoot,
          executionRoot,
        }))),
        provider,
        session: input,
        deadline: startedAt + TERMINAL_HOOK_BUDGET_MS,
        now: new Date(),
      }),
  ).catch(() => null);
  // A hosted session with an agent also learns its conversation (Lervo ADE rooms).
  const room =
    process.env.LERVO_AGENT_ID === undefined
      ? null
      : await withinTerminalDeadline(startedAt + TERMINAL_HOOK_BUDGET_MS, () =>
          roomBlock(input.providerSessionId),
        ).catch(() => null);
  const context = [additionalContext, room].filter((part) => part !== null).join("\n\n");
  io.stdout(
    context.length === 0
      ? "{}\n"
      : `${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } })}\n`,
  );
  // Schema 12: a resumed session whose last turn no Stop closed settles that turn now.
  await settleOnSessionStart(io.cwd, provider, input).catch(() => false);
}
