import { randomUUID } from "node:crypto";

import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import { terminalTranscriptPosition } from "@lervo/repository-knowledge-runtime";

import { TERMINAL_AGENTS_POINTER } from "./terminal-compact-format.js";
import { capContextBytes, MAXIMUM_COMPACT_CONTEXT_BYTES } from "./terminal-context-budget.js";
import { prepareTerminalBaseParts } from "./terminal-degraded-context.js";
import type { ParsedSessionStartInput } from "./terminal-hook-contract.js";
import {
  baseRulesDelivered,
  removeTerminalContextEpoch,
  writeTerminalContextEpoch,
  type TerminalEpochCause,
} from "./terminal-context-epoch.js";

export type { TerminalEpochCause } from "./terminal-context-epoch.js";

const CAUSE_LABELS: Record<TerminalEpochCause, string> = {
  startup: "session start",
  resume: "session resume",
  clear: "context clear",
  compact: "context compaction",
};

/** Owner-rule bytes in the base; the rest of the 4 KiB holds the pointer, policy, and headline. */
const BASE_RULE_BYTES = 2816;
/**
 * The per-turn bookkeeping instruction differs for worker workspaces and arrives with every prompt,
 * so the base, which reads no workspace binding, leaves it out.
 */
const BOOKKEEPING_LINE = "If this turn changes repository-authored bytes";

/**
 * The base block for a provider `SessionStart` (ADR-0562 section 4): the repository pointer, the
 * publication policy, the applied owner rules, and the workstream headline, from independent local
 * reads with no repository snapshot. A compaction or clear starts a new epoch, so the model gets
 * the base back after it lost the earlier turns. The block names its epoch id, so its transcript
 * record can be found later; a failed epoch write still answers with the base block.
 */
export async function prepareTerminalSessionStart(input: {
  root: string;
  /** The checkout the session runs in; its branch selects the workstream. Defaults to `root`. */
  executionRoot?: string;
  provider: TerminalIntegrationProvider;
  session: ParsedSessionStartInput;
  deadline: number;
  now: Date;
}): Promise<string> {
  // The old epoch goes first: a start that fails later must leave full delivery.
  await removeTerminalContextEpoch(
    input.root,
    input.provider,
    input.session.providerSessionId,
  ).catch(() => undefined);
  const transcript = await terminalTranscriptPosition(input.provider, input.session.transcriptPath);
  const epochId = `tepoch_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const { lines, rules } = await prepareTerminalBaseParts(
    input.root,
    input.deadline,
    BASE_RULE_BYTES,
    input.executionRoot ?? input.root,
  );
  const base = capContextBytes(
    [
      lines[0] ?? TERMINAL_AGENTS_POINTER,
      `Lervo base context for this ${CAUSE_LABELS[input.session.source]} (epoch ${epochId}).`,
      ...lines.slice(1).filter((line) => !line.startsWith(BOOKKEEPING_LINE)),
    ].join("\n\n"),
    MAXIMUM_COMPACT_CONTEXT_BYTES,
  );
  await writeTerminalContextEpoch(input.root, input.session.providerSessionId, {
    schemaVersion: 2,
    epochId,
    provider: input.provider,
    cause: input.session.source,
    startedAt: input.now.toISOString(),
    baseRules: baseRulesDelivered(rules, base),
    transcriptOffset: transcript?.offset ?? 0,
  }).catch(() => undefined);
  return base;
}
