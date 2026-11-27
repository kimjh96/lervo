// What the host proves of a conversation generation's checkout before its coordination ends (Lervo
// ADE coordination, "Lease lifetime"): its directory is gone, and Git no longer registers it.
import { lstat } from "node:fs/promises";

import type { AgentWorkspace, ConversationCheckoutRemoval } from "@lervo/agent-workforce";

import { terminalWorkspaceHost, terminalWorkspaceMarker } from "./terminal-workspace-boundary.js";

const NO_PROOF: ConversationCheckoutRemoval = { hostAbsent: false, gitMetadataAbsent: false };

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
 * The proof for the checkout the generation names. Git is asked only once the directory is gone,
 * so a checkout still on disk costs one `lstat` and proves nothing.
 */
export async function conversationCheckoutRemoval(
  root: string,
  workspace: AgentWorkspace,
): Promise<ConversationCheckoutRemoval> {
  const path = workspace.ownerWorkspacePath;
  if (path === undefined || !(await pathAbsent(path))) return NO_PROOF;
  const inspected = await terminalWorkspaceHost(workspace).inspect({
    repositoryRoot: root,
    workspacePath: path,
    baseCommit: workspace.baseCommit,
    marker: terminalWorkspaceMarker(workspace),
  });
  return { hostAbsent: true, gitMetadataAbsent: inspected.status === "absent" };
}
