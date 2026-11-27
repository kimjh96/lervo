// Retiring a conversation's coordination with its hosted workspace (Lervo ADE coordination,
// "Lease lifetime"): the refusal while a sealed change waits for integration, and, once the
// worktree is gone, the holder-bound cancellation of its lease and the removal of its generation
// records and changed paths. Behind the coordination gate: a closed gate reads nothing.
import { lstat } from "node:fs/promises";

import {
  AgentWorkforceError,
  assertConversationRetirable,
  listConversationWorkspaceGenerations,
  retireConversation,
  type ConversationCheckoutRemoval,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { CommandFailure } from "./command-error-output.js";
import { coordinationGateOpen } from "./coordination-gate.js";
import { terminalWorkspaceHost, terminalWorkspaceMarker } from "./terminal-workspace-boundary.js";
import { recordWorkforceEvent } from "./workforce-events.js";

/** What retiring a hosted workspace does for the conversation it hosted. */
export interface ConversationRetirementEffects {
  /** Refuses with `workspace_integration_pending` before anything is removed. */
  assertRetirable(root: string, conversationId: string): Promise<void>;
  /** Releases the conversation's lease and removes its records once its worktree is gone. */
  retire(root: string, conversationId: string): Promise<void>;
}

/** The workforce's refusal as the command's failure, keeping its code. */
function asCommandFailure(error: unknown, conversationId: string): never {
  if (error instanceof AgentWorkforceError && error.code === "workspace_integration_pending")
    throw new CommandFailure(
      "workspace_integration_pending",
      "A sealed change of this conversation waits for integration. Retire it after it integrates.",
      { workspaceId: conversationId },
    );
  throw error;
}

async function pathAbsent(path: string): Promise<boolean> {
  return lstat(path).then(
    () => false,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return true;
      throw error;
    },
  );
}

/**
 * What the host proves of the checkout every generation names: its directory is gone, and Git no
 * longer registers it as a worktree.
 */
async function checkoutRemoval(
  root: string,
  conversationId: string,
): Promise<ConversationCheckoutRemoval | null> {
  const live = (await listConversationWorkspaceGenerations(root, conversationId)).filter(
    (workspace) => workspace.state !== "removed",
  );
  const newest = live.at(-1);
  if (newest === undefined) return null;
  const path = newest.ownerWorkspacePath;
  const hostAbsent = path !== undefined && (await pathAbsent(path));
  const inspected =
    path === undefined
      ? null
      : await terminalWorkspaceHost(newest).inspect({
          repositoryRoot: root,
          workspacePath: path,
          baseCommit: newest.baseCommit,
          marker: terminalWorkspaceMarker(newest),
        });
  return { hostAbsent, gitMetadataAbsent: inspected?.status === "absent" };
}

export function conversationRetirementEffects(
  environment: NodeJS.ProcessEnv = process.env,
): ConversationRetirementEffects {
  return {
    async assertRetirable(root, conversationId) {
      if (!(await coordinationGateOpen(root, environment))) return;
      await assertConversationRetirable(root, conversationId).catch((error: unknown) =>
        asCommandFailure(error, conversationId),
      );
    },
    async retire(root, conversationId) {
      if (!(await coordinationGateOpen(root, environment))) return;
      const checkout = await checkoutRemoval(root, conversationId);
      if (checkout === null) return;
      const storage = await openProjectStorage(root);
      try {
        await retireConversation({
          repositoryRoot: root,
          conversationId,
          checkout,
          recordEvent: (event) => recordWorkforceEvent(storage, event),
        }).catch((error: unknown) => asCommandFailure(error, conversationId));
      } finally {
        await storage.close();
      }
    },
  };
}
