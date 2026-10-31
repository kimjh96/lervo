import { formatDegradedTerminalContext } from "./terminal-compact-format.js";
import { withTerminalSnapshotDeadline } from "./terminal-repository-snapshot.js";
import { parseArgs } from "node:util";

import { type TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import {
  newTerminalIdentifier,
  TERMINAL_HOOK_BUILD_DIGEST,
  TERMINAL_OBSERVATION_POLICY_VERSION,
  unmanagedTerminalCoordinates,
} from "./terminal-event-coordinates.js";
import type { UnmanagedTerminalCoordinates } from "./terminal-hook-contract.js";
import { parseTerminalHookInput } from "./terminal-hook-input.js";
import { prepareAndRecordTerminalPrompt } from "./terminal-prompt-hook.js";
import { completeTerminalHookTurn } from "./terminal-stop-hook.js";
import {
  budgetTerminalStages,
  terminalHookFailureReason,
  TERMINAL_HOOK_BUDGET_MS,
  withinTerminalDeadline,
} from "./terminal-hook-budget.js";
import { prepareTerminalBaseContext } from "./terminal-degraded-context.js";
import { resolveTerminalRepositoryRoot } from "./terminal-repository-root.js";
import { recordTerminalStageObservation } from "./terminal-stage-persistence.js";
import { preparedTerminalTurnExpectation } from "./terminal-turn-observation.js";
import {
  attachTerminalWorkspace,
  TerminalWorkspaceIsolationError,
  type TerminalWorkspaceBinding,
} from "./terminal-workspace-lifecycle.js";
import type { CliIo, CliServices } from "./types.js";

export function runTerminalHookCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "createTerminalStageObservation" | "projectSearchQueries">,
): Promise<number> {
  const startedAt = performance.now();
  return withTerminalSnapshotDeadline(startedAt + TERMINAL_HOOK_BUDGET_MS / 2, () =>
    executeTerminalHookCommand(args, io, services, startedAt),
  );
}

async function executeTerminalHookCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "createTerminalStageObservation" | "projectSearchQueries">,
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
        input: parseTerminalHookInput(await io.stdin()),
      };
    });
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
    let workspaceBinding: TerminalWorkspaceBinding | null = null;
    try {
      const root = await timing.measure("repository_discovery", () =>
        resolveTerminalRepositoryRoot(io.cwd),
      );
      stageContext.root = root;
      repositoryRoot = root;
      const occurredAt = new Date().toISOString();
      if (input.event === "UserPromptSubmit") {
        const observationId = stageContext.observationId;
        try {
          workspaceBinding = await timing.measure("lifecycle_inspection", () =>
            attachTerminalWorkspace({
              root,
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
          services,
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
          ? prepareTerminalBaseContext(repositoryRoot, startedAt + TERMINAL_HOOK_BUDGET_MS)
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
      const root = await resolveTerminalRepositoryRoot(io.cwd);
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
