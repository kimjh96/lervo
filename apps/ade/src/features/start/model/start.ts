import type { ApplicationCommands } from "../../../platform/session-host";
import { reloadWorkspaces, useWorkspaceStore } from "../../workspaces";

/**
 * What the start screen collects. The conversation mode is not chosen here: the core uses the
 * provider's preferred conversation, and the workspace header switches it later.
 */
export interface StartDraft {
  readonly instruction: string;
  readonly repository: string;
  readonly provider: string;
}

/** A draft the core can run: an instruction and a repository. */
export function canStart(draft: StartDraft): boolean {
  return draft.instruction.trim().length > 0 && draft.repository.length > 0;
}

/**
 * Starts work: Lervo creates the worktree, branch, and workstream, and the session host launches
 * the agent with the instruction. The new workspace is then listed and selected.
 */
export async function startWork(commands: ApplicationCommands, draft: StartDraft): Promise<void> {
  const result = await commands.run("workspace.start", {
    instruction: draft.instruction.trim(),
    repository: draft.repository,
    provider: draft.provider,
  });
  await reloadWorkspaces(commands);
  if (typeof result.workspaceId === "string")
    useWorkspaceStore.getState().select(result.workspaceId);
}
