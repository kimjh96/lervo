// The conversation a session's write claims for (Lervo ADE coordination, "Where the handler
// runs"): the lead's hosted launch record names it, and a session without one, such as the owner's
// own terminal, finds it from the worktree's newest workspace record.
import { realpath } from "node:fs/promises";

import {
  isConversationWorkspace,
  listWorkspaces,
  newestCheckoutWorkspace,
  newestConversationWorkspace,
  type AgentWorkspace,
} from "@lervo/agent-workforce";
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import { checkoutPathDigests } from "./checkout-path-digests.js";
import {
  hostedLaunchRecordsPath,
  latestHostedLaunchOfSession,
  type HostedLaunchRecord,
} from "./hosted-launch-records.js";
import { terminalWriterSessionId } from "./terminal-workspace-boundary.js";
import {
  defaultTerminalRootsPorts,
  resolveTerminalRoots,
  type TerminalRoots,
} from "./terminal-roots.js";
import { coordinationStageEnabled } from "./workspace-coordination.js";
import type { WritingSession } from "./claim-contract.js";

/** A conversation whose coordination is active, as one session's write claims for it. */
export interface ClaimingConversation extends WritingSession {
  /** The conversation's workspace ID, which every generation of its checkout shares. */
  readonly workspaceId: string;
  /** The lead, whose lease the conversation's claims widen. */
  readonly agentId: string;
  readonly provider: TerminalIntegrationProvider;
  /** The registered repository: its coordination home, event store, and open-turn markers. */
  readonly repositoryRoot: string;
  /** The real path of the conversation's worktree. */
  readonly worktree: string;
  /** The conversation assignment of the checkout's newest generation. */
  readonly assignmentId: string;
  /**
   * The lead session's writer session, or null for a session without a launch record, which
   * claims under the writer session of the conversation's lease, as the lead's session does.
   */
  readonly writerSessionId: string | null;
}

/** What finding the conversation reads; each is replaced in tests. */
export interface ClaimingConversationPorts {
  /** Whether the coordination stage's gate is open. */
  coordinationEnabled(): boolean;
  launchOfSession(providerSessionId: string): Promise<HostedLaunchRecord | null>;
  registeredRoot(projectId: string): Promise<string | null>;
  terminalRoots(workingDirectory: string): Promise<TerminalRoots>;
  workspaces(repositoryRoot: string): Promise<AgentWorkspace[]>;
}

export const defaultClaimingConversationPorts: ClaimingConversationPorts = {
  coordinationEnabled: () => coordinationStageEnabled(process.env),
  launchOfSession: (providerSessionId) =>
    latestHostedLaunchOfSession(hostedLaunchRecordsPath(), providerSessionId),
  registeredRoot: (projectId) =>
    resolveRegisteredRepository({ registryPath: defaultRepositoryRegistryPath(), projectId }).then(
      (registration) => registration.repositoryRoot,
      () => null,
    ),
  // Finding the conversation reads the checkout's records itself, so root resolution need not.
  terminalRoots: (workingDirectory) =>
    resolveTerminalRoots(workingDirectory, {
      ...defaultTerminalRootsPorts,
      workerCheckout: () => Promise.resolve(false),
    }),
  workspaces: (repositoryRoot) => listWorkspaces(repositoryRoot),
};

async function claiming(
  workspace: AgentWorkspace | null,
  found: Omit<ClaimingConversation, "worktree" | "assignmentId" | "workspaceId" | "agentId"> & {
    readonly agentId?: string;
  },
): Promise<ClaimingConversation | null> {
  if (
    workspace === null ||
    !isConversationWorkspace(workspace) ||
    workspace.ownerWorkspacePath === undefined
  )
    return null;
  return {
    ...found,
    workspaceId: workspace.conversationId!,
    agentId: found.agentId ?? workspace.agentId,
    worktree: await realpath(workspace.ownerWorkspacePath).catch(
      () => workspace.ownerWorkspacePath!,
    ),
    assignmentId: workspace.assignmentId,
  };
}

/**
 * The conversation a session's write claims for, or null when the session claims nothing: the gate
 * is closed, the session is a joined agent's, which reads, or no conversation workspace record
 * speaks for it, as below schema 16. A closed gate reads no state, and a main checkout spawns no
 * Git, so the hook stays cheap on every write tool call.
 */
export async function findClaimingConversation(
  input: {
    readonly provider: TerminalIntegrationProvider;
    readonly providerSessionId: string;
    readonly workingDirectory: string;
  },
  ports: ClaimingConversationPorts = defaultClaimingConversationPorts,
): Promise<ClaimingConversation | null> {
  if (!ports.coordinationEnabled()) return null;
  const launch = await ports.launchOfSession(input.providerSessionId);
  if (launch?.access === "read") return null;
  if (launch?.agentId !== undefined) {
    const repositoryRoot = await ports.registeredRoot(launch.projectId);
    if (repositoryRoot === null) return null;
    const workspace = newestConversationWorkspace(
      await ports.workspaces(repositoryRoot),
      launch.workspaceId,
    );
    return claiming(workspace, {
      agentId: launch.agentId,
      provider: input.provider,
      repositoryRoot,
      writerSessionId: terminalWriterSessionId(input.provider, input.providerSessionId),
    });
  }
  const roots = await ports.terminalRoots(input.workingDirectory);
  if (roots.reason !== "linked_worktree") return null;
  const workspace = newestCheckoutWorkspace(
    await ports.workspaces(roots.evidenceRoot),
    await checkoutPathDigests(roots.executionRoot),
  );
  return claiming(workspace, {
    provider: input.provider,
    repositoryRoot: roots.evidenceRoot,
    writerSessionId: null,
  });
}
