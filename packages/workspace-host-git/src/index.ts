import {
  type WorkspaceCleanupHostAdapter,
  type WorkspaceHostAdapter,
  type WorkspaceProvisionRequest,
  type WorkspaceRemovalRequest,
} from "@lervo/workspace-host";

import { GitWorkspaceEvidence } from "./evidence.js";

const VERSION = "1.0.0";

export class GitWorkspaceHostAdapter implements WorkspaceHostAdapter, WorkspaceCleanupHostAdapter {
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

  constructor(private readonly beforeProvision?: () => Promise<void>) {}

  provision(request: WorkspaceProvisionRequest) {
    return this.evidence.provisionDetached(request, this.beforeProvision);
  }

  inspect = this.evidence.inspect.bind(this.evidence);
  inspectResult = this.evidence.inspectResult.bind(this.evidence);
  inspectCleanup = this.evidence.inspectCleanup.bind(this.evidence);

  remove(request: WorkspaceRemovalRequest) {
    return this.evidence.removeNonForce(request);
  }
}

export { GitWorkspaceEvidence } from "./evidence.js";
export * from "./integration.js";
