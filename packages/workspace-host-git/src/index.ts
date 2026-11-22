import {
  type WorkspaceBranchHostAdapter,
  type WorkspaceBranchProvisionRequest,
  type WorkspaceBranchRemovalRequest,
  type WorkspaceCleanupHostAdapter,
  type WorkspaceHostAdapter,
  type WorkspaceProvisionRequest,
  type WorkspaceRemovalRequest,
} from "@lervo/workspace-host";

import { GitWorkspaceEvidence } from "./evidence.js";
import { GitWorktreeEffects } from "./worktree-effects.js";

const VERSION = "1.0.0";

export class GitWorkspaceHostAdapter
  implements WorkspaceHostAdapter, WorkspaceCleanupHostAdapter, WorkspaceBranchHostAdapter
{
  readonly kind = "git" as const;
  readonly version = VERSION;
  readonly capabilities = {
    provision: true,
    inspect: true,
    cleanupInspection: true,
    nonForceRemoval: true,
    processObservation: false,
  } as const;
  private readonly evidence = new GitWorkspaceEvidence({ kind: this.kind, version: this.version });
  private readonly effects = new GitWorktreeEffects(this.evidence);

  constructor(private readonly beforeProvision?: () => Promise<void>) {}

  provision(request: WorkspaceProvisionRequest) {
    return this.effects.provisionDetached(request, this.beforeProvision);
  }

  provisionBranch(request: WorkspaceBranchProvisionRequest) {
    return this.effects.provisionBranch(request, this.beforeProvision);
  }

  removeBranch(request: WorkspaceBranchRemovalRequest) {
    return this.effects.removeBranch(request);
  }

  inspect = this.evidence.inspect.bind(this.evidence);
  inspectResult = this.evidence.inspectResult.bind(this.evidence);
  inspectCleanup = this.evidence.inspectCleanup.bind(this.evidence);

  remove(request: WorkspaceRemovalRequest) {
    return this.effects.removeNonForce(request);
  }

  removeDiscardingChanges(request: WorkspaceRemovalRequest) {
    return this.effects.removeDiscardingChanges(request);
  }
}

export { GitWorkspaceEvidence } from "./evidence.js";
export * from "./integration.js";
