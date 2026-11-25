import { formatDegradedTerminalContext } from "./terminal-compact-format.js";
import { withTerminalSnapshotDeadline } from "./terminal-repository-snapshot.js";
import { parseArgs } from "node:util";

import { turnEndingEventSchemaVersion } from "@lervo/event-contract";
import { inspectEventWriterCoordinate } from "@lervo/project";

import { type TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import {
  newTerminalIdentifier,
  TERMINAL_HOOK_BUILD_DIGEST,
  TERMINAL_OBSERVATION_POLICY_VERSION,
  terminalProviderSessionDigest,
  unmanagedTerminalCoordinates,
} from "./terminal-event-coordinates.js";
import type { UnmanagedTerminalCoordinates } from "./terminal-hook-contract.js";
import { parseTerminalHookIngress } from "./terminal-hook-input.js";
import { prepareAndRecordTerminalPrompt } from "./terminal-prompt-hook.js";
import { completeTerminalHookTurn } from "./terminal-stop-hook.js";
import {
  budgetTerminalStages,
  terminalHookFailureReason,
  TERMINAL_HOOK_BUDGET_MS,
  withinTerminalDeadline,
} from "./terminal-hook-budget.js";
import { prepareTerminalBaseContext } from "./terminal-degraded-context.js";
import { prepareTerminalSessionStart } from "./terminal-session-start.js";
import { recordTerminalStageObservation } from "./terminal-stage-persistence.js";
import { preparedTerminalTurnExpectation } from "./terminal-turn-observation.js";
import {
  attachTerminalWorkspace,
  TerminalWorkspaceIsolationError,
  type TerminalWorkspaceBinding,
} from "./terminal-workspace-lifecycle.js";
import type { CliIo, CliServices } from "./types.js";
import { resolveTerminalRoots } from "./terminal-roots.js";
import { requestOpenTerminalTurnSettlement } from "./terminal-turn-settlement.js";
import { launchTerminalTurnSettlements } from "./terminal-turn-settlement-lease.js";

export function runTerminalHookCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "createTerminalStageObservation">,
  /**
   * When the hook started. The context server passes the client's start, so the budget and the
   * recorded total include the time the launcher spent before the request arrived.
   */
  startedAt = performance.now(),
): Promise<number> {
  return withTerminalSnapshotDeadline(startedAt + TERMINAL_HOOK_BUDGET_MS / 2, () =>
    executeTerminalHookCommand(args, io, services, startedAt),
  );
}

async function executeTerminalHookCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "createTerminalStageObservation">,
  startedAt: number,
): Promise<number> {
  const timing = budgetTerminalStages(
    services.createTerminalStageObservation(TERMINAL_HOOK_BUILD_DIGEST),
    startedAt,
  );
  try {
    const { provider, contractId, input } = await timing.measure("ingress_integrity", async () => {
      const parsed = parseArgs({
        args,
        strict: true,
        allowPositionals: false,
        options: { provider: { type: "string" }, contract: { type: "string" } },
      });
      if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude")
        throw new Error("--provider must be codex or claude.");
      const provider: TerminalIntegrationProvider = parsed.values.provider;
      if (parsed.values.contract !== "1" && parsed.values.contract !== "2")
        throw new Error("Unsupported terminal integration contract.");
      if (io.stdin === undefined) throw new Error("Provider hook input is unavailable.");
      return {
        provider,
        contractId:
          parsed.values.contract === "2"
            ? ("lervo_terminal_hooks_v2" as const)
            : ("lervo_terminal_hooks_v1" as const),
        input: parseTerminalHookIngress(await io.stdin()),
      };
    });
    if (input.event === "SessionStart") {
      // ADR-0562 section 4: the epoch's base block. Without it the next prompt still delivers the
      // full context, so a failure answers with nothing instead of blocking the session.
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
      io.stdout(
        additionalContext === null
          ? "{}\n"
          : `${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } })}\n`,
      );
      // Schema 12: a resumed session whose last turn no Stop closed settles that turn now.
      await settleOnSessionStart(io.cwd, provider, input).catch(() => false);
      return 0;
    }
    if (input.event === "Stop" && input.stopHookActive) {
      io.stdout("{}\n");
      return 0;
    }
    const coordinates = unmanagedTerminalCoordinates(provider, input);
    const stageContext: {
      root: string;
      coordinates: UnmanagedTerminalCoordinates;
      observationId: string;
    } = {
      root: io.cwd,
      coordinates,
      observationId: newTerminalIdentifier("tobs"),
    };
    let repositoryRoot: string | undefined;
    let checkoutRoot: string | undefined;
    let workspaceBinding: TerminalWorkspaceBinding | null = null;
    try {
      // A linked worktree runs in its own files and records into its registered repository.
      const { evidenceRoot: root, executionRoot } = await timing.measure(
        "repository_discovery",
        () => resolveTerminalRoots(io.cwd),
      );
      stageContext.root = root;
      repositoryRoot = root;
      checkoutRoot = executionRoot;
      const occurredAt = new Date().toISOString();
      if (input.event === "UserPromptSubmit") {
        const observationId = stageContext.observationId;
        try {
          workspaceBinding = await timing.measure("lifecycle_inspection", () =>
            attachTerminalWorkspace({
              root: executionRoot,
              provider,
              providerSessionId: input.providerSessionId,
              now: new Date(occurredAt),
            }),
          );
        } catch (error) {
          if (!(error instanceof TerminalWorkspaceIsolationError)) throw error;
          await recordTerminalStageObservation({
            root,
            coordinates,
            observationId,
            hookEvent: input.event,
            timing,
            outcome: "completed",
            policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
          });
          io.stdout(
            `${JSON.stringify({
              decision: "block",
              reason: `Lervo blocked terminal workspace attachment.\n${error.code}: run lervo workspace inspect --json and recover only this assignment workspace.`,
            })}\n`,
          );
          return 0;
        }
        const additionalContext = await prepareAndRecordTerminalPrompt({
          root,
          executionRoot,
          prompt: input.prompt!,
          providerSessionId: input.providerSessionId,
          transcriptPath: input.transcriptPath,
          provider,
          observationId,
          workspaceBinding,
          timing,
          coordinates,
          contractId,
          occurredAt,
          deadlineMs: startedAt + TERMINAL_HOOK_BUDGET_MS,
        });
        io.stdout(
          `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } })}\n`,
        );
        return 0;
      }
      const expectation = await timing.measure("lifecycle_inspection", () =>
        preparedTerminalTurnExpectation(root, coordinates, provider, input.providerSessionId),
      );
      if (expectation === null) {
        io.stdout("{}\n");
        return 0;
      }
      stageContext.observationId = expectation.observationId;
      return await completeTerminalHookTurn({
        root,
        executionRoot,
        coordinates,
        input,
        provider,
        contractId,
        occurredAt,
        expectation,
        timing,
        io,
      });
    } catch (error) {
      const failureReason = terminalHookFailureReason(error);
      const baseContext =
        input.event === "UserPromptSubmit" && repositoryRoot !== undefined
          ? prepareTerminalBaseContext(
              repositoryRoot,
              startedAt + TERMINAL_HOOK_BUDGET_MS,
              checkoutRoot,
            )
          : Promise.resolve([]);
      await withinTerminalDeadline(startedAt + TERMINAL_HOOK_BUDGET_MS, () =>
        recordTerminalStageObservation({
          ...stageContext,
          hookEvent: input.event,
          timing,
          outcome: "failed",
          failureReason,
          policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
        }),
      ).catch(() => undefined);
      if (input.event === "UserPromptSubmit") {
        const lines = await baseContext;
        io.stdout(
          `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: formatDegradedTerminalContext(lines, failureReason, workspaceBinding) } })}\n`,
        );
      } else io.stdout("{}\n");
      return 0;
    }
  } catch (error) {
    const failureReason = terminalHookFailureReason(error);
    const observationId = newTerminalIdentifier("tobs");
    // Rejected ingress has no trustworthy provider session or hook event. Keep it unattributed.
    await withinTerminalDeadline(startedAt + TERMINAL_HOOK_BUDGET_MS, async () => {
      const root = (await resolveTerminalRoots(io.cwd)).evidenceRoot;
      await recordTerminalStageObservation({
        root,
        coordinates: {
          runId: `run_unattributed_${observationId.slice(5)}`,
          sessionId: `ses_unattributed_${observationId.slice(5)}`,
        },
        observationId,
        timing,
        outcome: "failed",
        failureReason,
        policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
      });
    }).catch(() => undefined);
    io.stderr(`Lervo terminal integration failed (${failureReason}).\n`);
    return 2;
  }
}

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
