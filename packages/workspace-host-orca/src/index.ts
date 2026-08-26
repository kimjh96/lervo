import { createHash } from "node:crypto";
import { basename } from "node:path";

import {
  WorkspaceHostError,
  type WorkspaceCleanupHostAdapter,
  type WorkspaceCleanupHostInspection,
  type WorkspaceCleanupInspectionRequest,
  type WorkspaceHostAdapter,
  type WorkspaceHostInspection,
  type WorkspaceInspectionRequest,
  type WorkspaceProvisionRequest,
  type WorkspaceRemovalRequest,
  type WorkspaceResultInspectionRequest,
} from "@lervo/workspace-host";
import { GitWorkspaceEvidence } from "@lervo/workspace-host-git";

import {
  OrcaCliWorkspaceClient,
  type OrcaWorkspaceClient,
  type OrcaWorkspaceSummary,
} from "./orca-client.js";

const VERSION = "1.0.0";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function linkedReviewCount(worktree: OrcaWorkspaceSummary): number {
  return [
    worktree.linkedPR,
    worktree.linkedGitLabMR,
    worktree.linkedBitbucketPR,
    worktree.linkedAzureDevOpsPR,
    worktree.linkedGiteaPR,
  ].filter((value) => value !== null).length;
}

export class OrcaWorkspaceHostAdapter implements WorkspaceHostAdapter, WorkspaceCleanupHostAdapter {
  readonly kind = "orca" as const;
  readonly version = VERSION;
  readonly capabilities = {
    provision: true,
    inspect: true,
    cleanupInspection: true,
    nonForceRemoval: true,
    processObservation: true,
  } as const;
  private readonly evidence = new GitWorkspaceEvidence({ kind: this.kind, version: this.version });

  constructor(private readonly client: OrcaWorkspaceClient = new OrcaCliWorkspaceClient()) {}

  private async exactWorktree(
    repositoryRoot: string,
    workspacePath: string,
  ): Promise<OrcaWorkspaceSummary | null> {
    const matches = (await this.client.list(repositoryRoot)).filter(
      (worktree) => worktree.path === workspacePath,
    );
    if (matches.length > 1)
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "Multiple Orca worktrees occupy the cleanup coordinate.",
      );
    return matches[0] ?? null;
  }

  private async observedInspection(
    request: WorkspaceInspectionRequest,
  ): Promise<{ inspection: WorkspaceHostInspection; worktree: OrcaWorkspaceSummary | null }> {
    const [gitInspection, worktree] = await Promise.all([
      this.evidence.inspect(request),
      this.exactWorktree(request.repositoryRoot, request.workspacePath),
    ]);
    if (worktree === null) {
      if (gitInspection.status === "absent") return { inspection: gitInspection, worktree };
      return {
        inspection: {
          ...gitInspection,
          status: "recovery_required",
          processObservation: "unavailable",
        },
        worktree,
      };
    }
    const terminals = await this.client.terminalCount(worktree.id);
    const processObservation =
      terminals === null ? "unavailable" : terminals === 0 ? "quiescent" : "live";
    if (gitInspection.status === "absent" || gitInspection.headCommit !== worktree.head)
      return {
        inspection: {
          ...gitInspection,
          status: "recovery_required",
          processObservation,
          nativeInstanceDigest: digest(worktree.id),
        },
        worktree,
      };
    return {
      inspection: {
        ...gitInspection,
        processObservation,
        nativeInstanceDigest: digest(worktree.id),
      },
      worktree,
    };
  }

  async provision(request: WorkspaceProvisionRequest): Promise<WorkspaceHostInspection> {
    if (!/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey))
      throw new WorkspaceHostError("host_coordinate_invalid", "The Orca provision key is invalid.");
    const existing = await this.observedInspection(request);
    if (existing.inspection.status !== "absent") {
      if (
        existing.inspection.status === "present" &&
        existing.inspection.markerMatched &&
        existing.inspection.headCommit === request.baseCommit
      )
        return existing.inspection;
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "A different or incomplete Orca workspace occupies the provision coordinate.",
      );
    }
    const created = await this.client.create({
      repositoryRoot: request.repositoryRoot,
      name: basename(request.workspacePath),
      baseCommit: request.baseCommit,
    });
    if (created.path !== request.workspacePath)
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "Orca created a worktree at a different coordinate.",
      );
    try {
      await this.evidence.writeMarker(request.workspacePath, request.marker);
      await this.client.setLifecycle({
        worktreeId: created.id,
        status: "in-progress",
        comment: "Lervo workspace ready; one managed writer may start.",
      });
    } catch (error) {
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "The Orca worktree exists but lifecycle preparation is incomplete.",
        { cause: error },
      );
    }
    return (await this.observedInspection(request)).inspection;
  }

  async inspect(request: WorkspaceInspectionRequest): Promise<WorkspaceHostInspection> {
    return (await this.observedInspection(request)).inspection;
  }

  async inspectResult(request: WorkspaceResultInspectionRequest) {
    const [result, observed] = await Promise.all([
      this.evidence.inspectResult(request),
      this.observedInspection(request),
    ]);
    return { ...result, ...observed.inspection };
  }

  async inspectCleanup(
    request: WorkspaceCleanupInspectionRequest,
  ): Promise<WorkspaceCleanupHostInspection> {
    const [gitInspection, observed] = await Promise.all([
      this.evidence.inspectCleanup(request),
      this.observedInspection(request),
    ]);
    return {
      ...gitInspection,
      ...observed.inspection,
      dependentReferenceCount: observed.worktree?.childWorktreeIds.length ?? 0,
      childWorkspaceCount: observed.worktree?.childWorktreeIds.length ?? 0,
      reviewLinkCount: observed.worktree === null ? 0 : linkedReviewCount(observed.worktree),
    };
  }

  async remove(request: WorkspaceRemovalRequest): Promise<WorkspaceHostInspection> {
    if (!/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey))
      throw new WorkspaceHostError("host_coordinate_invalid", "The Orca removal key is invalid.");
    const before = await this.observedInspection(request);
    if (before.inspection.status === "absent") return before.inspection;
    if (
      before.worktree === null ||
      before.inspection.status !== "present" ||
      !before.inspection.markerMatched ||
      !before.inspection.clean ||
      before.inspection.gitOperationInProgress !== false ||
      before.inspection.processObservation !== "quiescent"
    )
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "Orca did not prove a clean, owned, quiescent worktree.",
      );
    await this.client.setLifecycle({
      worktreeId: before.worktree.id,
      status: "in-review",
      comment: "Lervo cleanup verified quiescence; non-force removal is in progress.",
    });
    await this.client.removeNonForce(before.worktree.id);
    const after = await this.observedInspection(request);
    if (after.inspection.status !== "absent")
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "Orca did not prove complete non-force worktree removal.",
      );
    return after.inspection;
  }
}

export {
  OrcaCliCommandRunner,
  OrcaCliWorkspaceClient,
  type OrcaCommandRunner,
  type OrcaWorkspaceClient,
  type OrcaWorkspaceCreateResult,
  type OrcaWorkspaceSummary,
} from "./orca-client.js";
