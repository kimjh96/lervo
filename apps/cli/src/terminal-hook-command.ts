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
import type {
  ParsedPreToolUseInput,
  ParsedSessionStartInput,
  UnmanagedTerminalCoordinates,
} from "./terminal-hook-contract.js";
import { parseTerminalHookIngress } from "./terminal-hook-input.js";
import { prepareAndRecordTerminalPrompt } from "./terminal-prompt-hook.js";
import { completeTerminalHookTurn } from "./terminal-stop-hook.js";
import { stopAnswer } from "./terminal-stop-answer.js";
import { reconcileAtStop } from "./conversation-turn-reconciliation.js";
import {
  budgetTerminalStages,
  terminalHookFailureReason,
  TERMINAL_HOOK_BUDGET_MS,
  withinTerminalDeadline,
} from "./terminal-hook-budget.js";
import { prepareTerminalBaseContext } from "./terminal-degraded-context.js";
import { prepareTerminalSessionStart } from "./terminal-session-start.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";
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
import { roomBlock } from "./room-context.js";
import { answerClaimHook } from "./write-claims.js";

/**
 * Claims at first write (Lervo ADE coordination). A claim that took the scheduler lock finishes
 * before the hook returns, so its process never exits holding the lock, and a context server
 * answers first and drains it before the next request.
 */
async function answerClaimAndSettle(
  input: ParsedPreToolUseInput,
  provider: TerminalIntegrationProvider,
  io: CliIo,
  observation: TerminalStageObservationPort,
): Promise<void> {
  const locked: Promise<unknown>[] = [];
  const answer = await answerClaimHook(input, provider, io.cwd, {
    trackWork: (work) => {
      locked.push(work);
      observation.trackWork?.(work);
    },
  });
  if (io.answer === undefined) io.stdout(answer);
  else io.answer(answer);
  await Promise.all(locked);
}

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
  const observation = services.createTerminalStageObservation(TERMINAL_HOOK_BUILD_DIGEST);
  const timing = budgetTerminalStages(observation, startedAt);
  try {
    const { provider, contractId, input } = await timing.measure("ingress_integrity", async () => {
      const parsed = parseArgs({
        args,
        strict: true,
        allowPositionals: false,
        options: {
          provider: { type: "string" },
          contract: { type: "string" },
          claim: { type: "boolean" },
        },
      });
      if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude")
        throw new Error("--provider must be codex or claude.");
      const provider: TerminalIntegrationProvider = parsed.values.provider;
      if (parsed.values.contract !== "1" && parsed.values.contract !== "2")
        throw new Error("Unsupported terminal integration contract.");
      if (io.stdin === undefined) throw new Error("Provider hook input is unavailable.");
      const input = parseTerminalHookIngress(await io.stdin());
      // The claim handler alone answers PreToolUse, so the launcher can defer it unread.
      if ((parsed.values.claim === true) !== (input.event === "PreToolUse"))
        throw new Error("Only the claim handler answers PreToolUse.");
      return {
        provider,
        contractId:
          parsed.values.contract === "2"
            ? ("lervo_terminal_hooks_v2" as const)
            : ("lervo_terminal_hooks_v1" as const),
        input,
      };
    });
    if (input.event === "PreToolUse") {
      await answerClaimAndSettle(input, provider, io, observation);
      return 0;
    }
    if (input.event === "SessionStart") {
      await answerSessionStart(io, provider, input, startedAt);
      return 0;
    }
    if (input.event === "Stop" && input.stopHookActive) {
      // The second run lets the turn end; a conversation's remaining conflicts become unresolved.
      await reconcileAtStop({ ...input, provider, workingDirectory: io.cwd, stopHookActive: true });
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
    /** Whether a served prompt already delivered its answer (ADR-0636). */
    let answered = false;
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
        const promptAnswer = (additionalContext: string) =>
          `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } })}\n`;
        // ADR-0636: a served prompt is answered once its context is prepared and recorded after.
        const answer = io.answer;
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
          ...(answer === undefined
            ? {}
            : {
                deliver: (prepared: string) => {
                  answered = true;
                  answer(promptAnswer(prepared));
                },
              }),
        });
        if (!answered) io.stdout(promptAnswer(additionalContext));
        return 0;
      }
      // A conversation reconciles its claims before its workspace is inspected, and its first
      // `Stop` blocks once on a conflict (Lervo ADE coordination, "Reconciliation").
      const conversationBlockReason = await timing.measure("lifecycle_inspection", () =>
        reconcileAtStop({ ...input, provider, workingDirectory: io.cwd, stopHookActive: false }),
      );
      const expectation = await timing.measure("lifecycle_inspection", () =>
        preparedTerminalTurnExpectation(root, coordinates, provider, input.providerSessionId),
      );
      if (expectation === null) {
        io.stdout(stopAnswer(conversationBlockReason));
        return 0;
      }
      stageContext.observationId = expectation.observationId;
      // ADR-0636: only a worker's Stop decides its block after inspection; any other Stop knows
      // its answer, so a served one answers as soon as the turn's repository is captured, and
      // records after. The provider may start the next turn then, and its edits must not count as
      // this turn's.
      const answer = io.answer;
      const answerAtCapture =
        answer !== undefined && expectation.workspaceBinding?.executionKind !== "worker"
          ? () => {
              answered = true;
              answer(stopAnswer(conversationBlockReason));
            }
          : undefined;
      return await completeTerminalHookTurn({
        conversationBlockReason,
        ...(answerAtCapture === undefined ? {} : { onRepositoryCaptured: answerAtCapture }),
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
      // A delivered prompt needs no fallback, so its base context is never prepared.
      const baseContext =
        !answered && input.event === "UserPromptSubmit" && repositoryRoot !== undefined
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
      // A delivered context stays delivered; a failure after it loses only its records.
      if (answered) return 0;
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
    // ADR-0635: an input Lervo cannot read never blocks the owner's prompt or forces a Stop to
    // continue, which a nonzero exit does in both providers. The failure is recorded above.
    io.stderr(`Lervo terminal integration failed (${failureReason}).\n`);
    io.stdout("{}\n");
    return 0;
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

/**
 * ADR-0562 section 4: the epoch's base block at a session start. Without it the next prompt still
 * delivers the full context, so a failure answers with nothing instead of blocking the session.
 */
async function answerSessionStart(
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
