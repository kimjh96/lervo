import {
  createKnowledgeMaterializationSettlement,
  type KnowledgeMaterializationSettlement,
  type KnowledgeMaterializationSettlementOptions,
} from "@lervo/repository-knowledge";

import type { CliIo } from "./types.js";

/** Clock, sleep, and budget overrides; production commands use the published defaults. */
export type KnowledgeMaterializationWaitTiming = Pick<
  KnowledgeMaterializationSettlementOptions,
  "waitMs" | "pollIntervalMs" | "now" | "sleep"
>;

/**
 * Provider hooks run under a 30-second timeout, so a hook waits only briefly for a live owner and
 * then reports the precise refusal instead of being killed mid-inspection.
 */
export const TERMINAL_HOOK_MATERIALIZATION_WAIT_MS = 10_000;

/**
 * A foreground command waits, bounded, for a live knowledge materialization owner to settle and
 * prints one notice per owner on stderr, which keeps JSON stdout parseable.
 */
export function foregroundKnowledgeMaterializationSettlement(input: {
  repositoryRoot: string;
  io: Pick<CliIo, "stderr">;
  timing?: KnowledgeMaterializationWaitTiming | undefined;
}): KnowledgeMaterializationSettlement {
  return createKnowledgeMaterializationSettlement({
    ...input.timing,
    repositoryRoot: input.repositoryRoot,
    onWait: (owner, remainingMs) =>
      input.io.stderr(
        `Waiting up to ${Math.max(1, Math.ceil(remainingMs / 60_000))} min for the live knowledge materialization owned by process ${owner.ownerPid} (plan ${owner.planId}, phase ${owner.phase}) to settle.\n`,
      ),
  });
}

export function terminalHookKnowledgeMaterializationSettlement(
  repositoryRoot: string,
): KnowledgeMaterializationSettlement {
  return createKnowledgeMaterializationSettlement({
    repositoryRoot,
    waitMs: TERMINAL_HOOK_MATERIALIZATION_WAIT_MS,
  });
}
