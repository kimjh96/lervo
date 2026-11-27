// Retiring a conversation's coordination with its hosted workspace (Lervo ADE coordination,
// "Lease lifetime"): the refusal while a sealed change waits for integration, finding the
// worktree by the path its generation record names, and, once the worktree is gone, the
// holder-bound cancellation of its lease and the removal of its generation records and changed
// paths. It runs whenever the conversation has generation records, whatever the coordination gate
// says: the gate decides what starts, never the cleanup of what exists. A conversation without
// records reads nothing past one read-only look for its first record.
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import {
  AgentWorkforceError,
  assertConversationRetirable,
  hasConversationWorkspaceRecords,
  listConversationWorkspaceGenerations,
  retireConversation,
  type AgentWorkspace,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { CommandFailure } from "./command-error-output.js";
import { conversationCheckoutRemoval } from "./conversation-checkout-removal.js";
import { runGit } from "./workspace-base-git.js";
import { recordWorkforceEvent } from "./workforce-events.js";

/** What retiring a hosted workspace does for the conversation it hosted. */
export interface ConversationRetirementEffects {
  /** Refuses with `workspace_integration_pending` before anything is removed. */
  assertRetirable(root: string, conversationId: string): Promise<void>;
  /**
   * The conversation's worktree as Git registers it at the path its newest generation record
   * names, or null. Retiring asks this when no worktree has the launch's branch checked out, as
   * after a branch switch or a detached `HEAD`.
   */
  worktreeOf(root: string, conversationId: string): Promise<string | null>;
  /**
   * Releases the conversation's lease and removes its records once its worktree is gone. A
   * checkout that is still on disk or still registered refuses with `workspace_worktree_unresolved`.
   */
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

/** The conversation's newest generation that is not `removed`, or null. */
async function newestLiveGeneration(
  root: string,
  conversationId: string,
): Promise<AgentWorkspace | null> {
  const live = (await listConversationWorkspaceGenerations(root, conversationId)).filter(
    (workspace) => workspace.state !== "removed",
  );
  return live.at(-1) ?? null;
}

/** Every worktree path Git registers for the repository, as real paths where they exist. */
async function registeredWorktrees(root: string): Promise<Set<string>> {
  const listing = await runGit(root, ["worktree", "list", "--porcelain"]);
  const paths = listing
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));
  return new Set(await Promise.all(paths.map((path) => realpath(path).catch(() => path))));
}

export function conversationRetirementEffects(): ConversationRetirementEffects {
  return {
    async assertRetirable(root, conversationId) {
      if (!(await hasConversationWorkspaceRecords(root, conversationId))) return;
      await assertConversationRetirable(root, conversationId).catch((error: unknown) =>
        asCommandFailure(error, conversationId),
      );
    },
    async worktreeOf(root, conversationId) {
      if (!(await hasConversationWorkspaceRecords(root, conversationId))) return null;
      const path = (await newestLiveGeneration(root, conversationId))?.ownerWorkspacePath;
      if (path === undefined) return null;
      const real = await realpath(path).catch(() => null);
      return real !== null && (await registeredWorktrees(root)).has(real) ? real : null;
    },
    async retire(root, conversationId) {
      if (!(await hasConversationWorkspaceRecords(root, conversationId))) return;
      const newest = await newestLiveGeneration(root, conversationId);
      if (newest === null) return;
      const checkout = await conversationCheckoutRemoval(root, newest);
      if (!checkout.hostAbsent || !checkout.gitMetadataAbsent)
        throw new CommandFailure(
          "workspace_worktree_unresolved",
          "The conversation's checkout is still on disk or still registered with Git, so its lease and records stay. Remove it, then retry.",
          { workspaceId: conversationId, path: newest.ownerWorkspacePath ?? null },
        );
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
