import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  WorkspaceHostError,
  type WorkspaceHostAdapter,
  type WorkspaceIntegrationAdvanceRequest,
  type WorkspaceIntegrationAdvanceResult,
  type WorkspaceIntegrationApplyRequest,
  type WorkspaceIntegrationApplyResult,
  type WorkspaceIntegrationHostAdapter,
  type WorkspaceIntegrationResetRequest,
  type WorkspaceIntegrationRollbackRequest,
  type WorkspaceIntegrationSource,
  type WorkspaceIntegrationTargetInspection,
  type WorkspaceIntegrationTargetRequest,
} from "@lervo/workspace-host";

import { advanceExactTargetRef, exactTargetCommit, rollbackExactTargetRef } from "./target-ref.js";

const execute = promisify(execFile);
const COMMIT = /^[a-f0-9]{40,64}$/u;
const VERSION = "1.0.0";

function fail(
  code: ConstructorParameters<typeof WorkspaceHostError>[0],
  message: string,
  cause?: unknown,
): never {
  throw new WorkspaceHostError(code, message, cause === undefined ? undefined : { cause });
}

async function git(
  root: string,
  arguments_: string[],
  environment?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await execute("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      ...(environment === undefined ? {} : { env: environment }),
    });
    return stdout.trim();
  } catch (error) {
    fail("host_git_failed", "The Git integration operation failed.", error);
  }
}

async function tryGit(
  root: string,
  arguments_: string[],
  environment?: NodeJS.ProcessEnv,
): Promise<boolean> {
  try {
    await execute("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      ...(environment === undefined ? {} : { env: environment }),
    });
    return true;
  } catch {
    return false;
  }
}

function validRequest(request: WorkspaceIntegrationTargetRequest): boolean {
  return (
    COMMIT.test(request.integrationBaseCommit) &&
    COMMIT.test(request.targetBeforeCommit) &&
    /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u.test(request.targetRef) &&
    !request.targetRef.includes("..") &&
    !request.targetRef.includes("@{")
  );
}

function validSource(source: WorkspaceIntegrationSource): boolean {
  return (
    /^wsp_[a-f0-9]{24}$/u.test(source.workspaceId) &&
    Number.isSafeInteger(source.generation) &&
    source.generation >= 1 &&
    COMMIT.test(source.headCommit) &&
    source.commitIds.length <= 10_000 &&
    source.commitIds.every((commitId) => COMMIT.test(commitId)) &&
    ["fast_forward", "cherry_pick", "merge"].includes(source.strategy)
  );
}

async function resetToTarget(request: WorkspaceIntegrationTargetRequest): Promise<boolean> {
  await tryGit(request.integrationWorkspacePath, ["cherry-pick", "--abort"]);
  await tryGit(request.integrationWorkspacePath, ["merge", "--abort"]);
  if (
    !(await tryGit(request.integrationWorkspacePath, [
      "reset",
      "--hard",
      request.targetBeforeCommit,
    ]))
  )
    return false;
  const target = await exactTargetCommit(request.repositoryRoot, request.targetRef);
  return target === request.targetBeforeCommit;
}

async function applySource(
  request: WorkspaceIntegrationApplyRequest,
  source: WorkspaceIntegrationSource,
): Promise<boolean> {
  if (source.commitIds.length === 0) return true;
  if (source.strategy === "fast_forward")
    return tryGit(request.integrationWorkspacePath, ["merge", "--ff-only", source.headCommit]);
  if (source.strategy === "cherry_pick")
    return tryGit(request.integrationWorkspacePath, ["cherry-pick", ...source.commitIds]);
  const environment = {
    ...process.env,
    GIT_AUTHOR_NAME: "Lervo Integration",
    GIT_AUTHOR_EMAIL: "integration@lervo.invalid",
    GIT_AUTHOR_DATE: request.commitTime,
    GIT_COMMITTER_NAME: "Lervo Integration",
    GIT_COMMITTER_EMAIL: "integration@lervo.invalid",
    GIT_COMMITTER_DATE: request.commitTime,
  };
  return tryGit(
    request.integrationWorkspacePath,
    [
      "merge",
      "--no-ff",
      "-m",
      `lervo integration ${source.workspaceId} generation ${source.generation}`,
      source.headCommit,
    ],
    environment,
  );
}

export class GitWorkspaceIntegrationAdapter implements WorkspaceIntegrationHostAdapter {
  readonly kind = "git" as const;
  readonly version = VERSION;
  readonly capabilities = {
    exactIntegration: true,
    conflictAbort: true,
    targetAdvance: true,
  } as const;

  constructor(private readonly workspaceHost: WorkspaceHostAdapter) {}

  async inspectTarget(
    request: WorkspaceIntegrationTargetRequest,
  ): Promise<WorkspaceIntegrationTargetInspection> {
    if (!validRequest(request))
      fail("host_coordinate_invalid", "The Git integration target coordinate is invalid.");
    const [workspace, targetCommit] = await Promise.all([
      this.workspaceHost.inspect({
        repositoryRoot: request.repositoryRoot,
        workspacePath: request.integrationWorkspacePath,
        baseCommit: request.integrationBaseCommit,
        marker: request.integrationMarker,
      }),
      exactTargetCommit(request.repositoryRoot, request.targetRef),
    ]);
    return { workspace, targetCommit };
  }

  async applyIntegration(
    request: WorkspaceIntegrationApplyRequest,
  ): Promise<WorkspaceIntegrationApplyResult> {
    if (
      !validRequest(request) ||
      !/^int_[a-f0-9]{24}$/u.test(request.attemptId) ||
      !/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey) ||
      request.sources.length === 0 ||
      request.sources.length > 32 ||
      !request.sources.every(validSource) ||
      !Number.isFinite(Date.parse(request.commitTime))
    )
      fail("host_coordinate_invalid", "The Git integration request is invalid.");
    const before = await this.inspectTarget(request);
    if (
      before.targetCommit !== request.targetBeforeCommit ||
      before.workspace.status !== "present" ||
      before.workspace.headCommit !== request.targetBeforeCommit ||
      !before.workspace.markerMatched ||
      !before.workspace.clean ||
      before.workspace.gitOperationInProgress !== false
    )
      fail("host_effect_uncertain", "The Git integration target changed before apply.");
    for (const source of request.sources) {
      if (await applySource(request, source)) continue;
      const operationAborted = await resetToTarget(request);
      if (!operationAborted)
        fail("host_effect_uncertain", "The Git integration conflict could not be aborted exactly.");
      const after = await this.inspectTarget(request);
      if (
        after.targetCommit !== request.targetBeforeCommit ||
        after.workspace.headCommit !== request.targetBeforeCommit ||
        !after.workspace.clean ||
        after.workspace.gitOperationInProgress !== false
      )
        fail("host_effect_uncertain", "The Git integration conflict recovery is uncertain.");
      return {
        status: "conflict",
        targetBeforeCommit: request.targetBeforeCommit,
        candidateCommit: null,
        candidateTreeHash: null,
        conflictWorkspaceId: source.workspaceId,
        conflictReason: "git_conflict",
        operationAborted: true,
        targetUnchanged: true,
      };
    }
    const [candidateCommit, candidateTreeHash, targetCommit, status] = await Promise.all([
      git(request.integrationWorkspacePath, ["rev-parse", "HEAD"]),
      git(request.integrationWorkspacePath, ["rev-parse", "HEAD^{tree}"]),
      exactTargetCommit(request.repositoryRoot, request.targetRef),
      git(request.integrationWorkspacePath, [
        "status",
        "--porcelain=v2",
        "--untracked-files=normal",
      ]),
    ]);
    if (targetCommit !== request.targetBeforeCommit || status.length > 0)
      fail("host_effect_uncertain", "The Git integration candidate is not isolated and clean.");
    return {
      status: "candidate",
      targetBeforeCommit: request.targetBeforeCommit,
      candidateCommit,
      candidateTreeHash,
      conflictWorkspaceId: null,
      conflictReason: null,
      operationAborted: false,
      targetUnchanged: true,
    };
  }

  async advanceTarget(
    request: WorkspaceIntegrationAdvanceRequest,
  ): Promise<WorkspaceIntegrationAdvanceResult> {
    if (
      !validRequest(request) ||
      !COMMIT.test(request.candidateCommit) ||
      !COMMIT.test(request.candidateTreeHash) ||
      !/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey)
    )
      fail("host_coordinate_invalid", "The Git integration advance request is invalid.");
    const before = await this.inspectTarget(request);
    if (
      (before.targetCommit !== request.targetBeforeCommit &&
        before.targetCommit !== request.candidateCommit) ||
      before.workspace.status !== "present" ||
      before.workspace.headCommit !== request.candidateCommit ||
      before.workspace.treeHash !== request.candidateTreeHash ||
      !before.workspace.markerMatched ||
      !before.workspace.clean ||
      before.workspace.gitOperationInProgress !== false
    )
      fail("host_effect_uncertain", "The Git integration candidate changed before advancement.");
    const status = await advanceExactTargetRef(request);
    const after = await this.inspectTarget(request);
    if (
      after.targetCommit !== request.candidateCommit ||
      after.workspace.headCommit !== request.candidateCommit ||
      after.workspace.treeHash !== request.candidateTreeHash ||
      !after.workspace.clean ||
      after.workspace.gitOperationInProgress !== false
    )
      fail("host_effect_uncertain", "The Git integration target advancement is uncertain.");
    return {
      status,
      targetBeforeCommit: request.targetBeforeCommit,
      targetAfterCommit: request.candidateCommit,
      candidateCommit: request.candidateCommit,
    };
  }

  async rollbackTarget(request: WorkspaceIntegrationRollbackRequest): Promise<boolean> {
    if (
      !validRequest(request) ||
      !COMMIT.test(request.candidateCommit) ||
      !COMMIT.test(request.candidateTreeHash) ||
      !/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey)
    )
      fail("host_coordinate_invalid", "The Git integration rollback request is invalid.");
    const before = await this.inspectTarget(request);
    if (
      (before.targetCommit !== request.targetBeforeCommit &&
        before.targetCommit !== request.candidateCommit) ||
      before.workspace.status !== "present" ||
      before.workspace.headCommit !== request.candidateCommit ||
      before.workspace.treeHash !== request.candidateTreeHash ||
      !before.workspace.markerMatched ||
      !before.workspace.clean ||
      before.workspace.gitOperationInProgress !== false
    )
      fail("host_effect_uncertain", "The Git integration candidate changed before rollback.");
    if (!(await rollbackExactTargetRef(request))) return false;
    const after = await this.inspectTarget(request);
    return (
      after.targetCommit === request.targetBeforeCommit &&
      after.workspace.headCommit === request.candidateCommit &&
      after.workspace.treeHash === request.candidateTreeHash &&
      after.workspace.clean === true &&
      after.workspace.gitOperationInProgress === false
    );
  }

  async resetCandidate(request: WorkspaceIntegrationResetRequest): Promise<boolean> {
    if (
      !validRequest(request) ||
      !COMMIT.test(request.candidateCommit) ||
      !/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey)
    )
      fail("host_coordinate_invalid", "The Git integration reset request is invalid.");
    const before = await this.inspectTarget(request);
    if (
      before.targetCommit !== request.targetBeforeCommit ||
      before.workspace.headCommit !== request.candidateCommit ||
      !before.workspace.markerMatched ||
      !before.workspace.clean ||
      before.workspace.gitOperationInProgress !== false
    )
      fail("host_effect_uncertain", "The Git integration candidate changed before reset.");
    if (!(await resetToTarget(request))) return false;
    const after = await this.inspectTarget(request);
    return (
      after.targetCommit === request.targetBeforeCommit &&
      after.workspace.headCommit === request.targetBeforeCommit &&
      after.workspace.clean === true &&
      after.workspace.gitOperationInProgress === false
    );
  }
}
