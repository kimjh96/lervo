import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import {
  enqueueInstructionCapture,
  listQueuedInstructionCaptures,
  readPrecedingAgentTurn,
  recordPrecedingAgentTurn,
} from "@lervo/repository-knowledge-runtime";

import type { TerminalWorkspaceBinding } from "./terminal-workspace-lifecycle.js";

/**
 * The hook-side half of ADR-0467 owner-turn capture. It only queues the owner's prompt, with the
 * agent reply that preceded it, for the knowledge resident; it never calls a provider, never
 * classifies text, and never writes an event. Sessions bound to an assignment workspace are
 * excluded because their prompts come from Lervo or another agent, not from the owner.
 */
export async function queueTerminalOwnerTurn(input: {
  root: string;
  provider: TerminalIntegrationProvider;
  providerSessionId: string;
  prompt: string;
  workspaceBinding: TerminalWorkspaceBinding | null;
  now: Date;
}): Promise<boolean> {
  if (input.workspaceBinding !== null) return false;
  const precedingAgentTurn = await readPrecedingAgentTurn({
    repositoryRoot: input.root,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    now: input.now,
  });
  const result = await enqueueInstructionCapture({
    repositoryRoot: input.root,
    source: "terminal_prompt",
    provider: input.provider,
    ownerTurn: input.prompt,
    precedingAgentTurn,
    now: input.now,
  });
  return result.status === "queued" || result.status === "already_queued";
}

/**
 * Keeps the agent's final reply of this turn as context for the owner's next prompt, and reports
 * whether queued owner turns are waiting so `Stop` can start a detached resident cycle.
 */
export async function settleTerminalAgentTurn(input: {
  root: string;
  provider: TerminalIntegrationProvider;
  providerSessionId: string;
  lastAssistantMessage: string | null | undefined;
  workspaceBinding: TerminalWorkspaceBinding | null;
  now: Date;
}): Promise<{ capturePending: boolean }> {
  if (input.workspaceBinding !== null) return { capturePending: false };
  await recordPrecedingAgentTurn({
    repositoryRoot: input.root,
    provider: input.provider,
    providerSessionId: input.providerSessionId,
    agentTurn: input.lastAssistantMessage ?? null,
    now: input.now,
  });
  return { capturePending: (await listQueuedInstructionCaptures(input.root)).length > 0 };
}
