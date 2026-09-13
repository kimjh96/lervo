import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import {
  WorkspaceHostError,
  type WorkspaceCleanupHostInspection,
  type WorkspaceCleanupInspectionRequest,
  type WorkspaceHostInspection,
  type WorkspaceHostKind,
  type WorkspaceInspectionRequest,
  type WorkspaceOwnershipMarker,
  type WorkspaceProvisionRequest,
  type WorkspaceRemovalRequest,
  type WorkspaceResultInspection,
  type WorkspaceResultInspectionRequest,
} from "@lervo/workspace-host";

const execute = promisify(execFile);
const COMMIT = /^[a-f0-9]{40,64}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const MARKER_NAME = "lervo-workspace-owner.json";

function fail(
  code: ConstructorParameters<typeof WorkspaceHostError>[0],
  message: string,
  cause?: unknown,
): never {
  throw new WorkspaceHostError(code, message, cause === undefined ? undefined : { cause });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

async function git(root: string, arguments_: string[]): Promise<string> {
  try {
    const { stdout } = await execute("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    fail("host_git_failed", "The Git workspace operation failed.", error);
  }
}

async function gitSucceeds(root: string, arguments_: string[]): Promise<boolean> {
  try {
    await execute("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    fail("host_git_failed", "The Git workspace predicate failed.", error);
  }
}

async function registeredWorktrees(repositoryRoot: string): Promise<Map<string, string>> {
  const output = await git(repositoryRoot, ["worktree", "list", "--porcelain", "-z"]);
  const records = new Map<string, string>();
  let path: string | null = null;
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) path = resolve(field.slice("worktree ".length));
    else if (path !== null && field.startsWith("HEAD ")) {
      records.set(path, field.slice("HEAD ".length));
      path = null;
    }
  }
  return records;
}

async function gitOperationInProgress(gitDirectory: string): Promise<boolean> {
  for (const name of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-merge",
    "rebase-apply",
  ]) {
    try {
      await lstat(resolve(gitDirectory, name));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return true;
    }
  }
  return false;
}

export class GitWorkspaceEvidence {
  constructor(private readonly binding: { kind: WorkspaceHostKind; version: string }) {}

  private validMarker(marker: WorkspaceOwnershipMarker): boolean {
    return (
      marker.schemaVersion === 1 &&
      /^wsp_[a-f0-9]{24}$/u.test(marker.workspaceId) &&
      Number.isSafeInteger(marker.generation) &&
      marker.generation >= 1 &&
      /^rpi_[a-f0-9]{24}$/u.test(marker.repositoryInstanceId) &&
      marker.adapterKind === this.binding.kind &&
      marker.adapterVersion === this.binding.version &&
      /^wpl_[a-f0-9]{24}$/u.test(marker.creationPlanId) &&
      HASH.test(marker.pathDigest)
    );
  }

  private validateRequest(
    repositoryRoot: string,
    workspacePath: string,
    marker: WorkspaceOwnershipMarker,
    allowSamePath = false,
  ): void {
    if (
      !isAbsolute(repositoryRoot) ||
      !isAbsolute(workspacePath) ||
      resolve(repositoryRoot) !== repositoryRoot ||
      resolve(workspacePath) !== workspacePath ||
      (!allowSamePath && repositoryRoot === workspacePath) ||
      !this.validMarker(marker)
    )
      fail("host_coordinate_invalid", "The Git workspace coordinate is invalid.");
  }

  private async markerMatches(
    gitDirectory: string,
    expected: WorkspaceOwnershipMarker,
  ): Promise<boolean> {
    try {
      const path = resolve(gitDirectory, MARKER_NAME);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) return false;
      return stableJson(JSON.parse(await readFile(path, "utf8"))) === stableJson(expected);
    } catch {
      return false;
    }
  }

  async writeMarker(workspacePath: string, marker: WorkspaceOwnershipMarker): Promise<void> {
    if (!this.validMarker(marker))
      fail("host_coordinate_invalid", "The workspace ownership marker is invalid.");
    const gitDirectory = await git(workspacePath, [
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
    ]);
    const handle = await open(
      resolve(gitDirectory, MARKER_NAME),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(marker, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async inspect(input: WorkspaceInspectionRequest): Promise<WorkspaceHostInspection> {
    this.validateRequest(input.repositoryRoot, input.workspacePath, input.marker, true);
    if (!COMMIT.test(input.baseCommit))
      fail("host_coordinate_invalid", "The Git inspection base is invalid.");
    const worktrees = await registeredWorktrees(input.repositoryRoot);
    let registeredPath = input.workspacePath;
    try {
      registeredPath = await realpath(input.workspacePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const registeredHead = worktrees.get(registeredPath);
    if (registeredHead === undefined)
      return {
        status: "absent",
        headCommit: null,
        treeHash: null,
        clean: null,
        gitOperationInProgress: null,
        changedPaths: null,
        markerMatched: false,
        processObservation: "unavailable",
        nativeInstanceDigest: null,
      };
    try {
      const info = await lstat(input.workspacePath);
      if (!info.isDirectory() || info.isSymbolicLink())
        return {
          status: "recovery_required",
          headCommit: registeredHead,
          treeHash: null,
          clean: null,
          gitOperationInProgress: null,
          changedPaths: null,
          markerMatched: false,
          processObservation: "unavailable",
          nativeInstanceDigest: digest({ path: input.workspacePath }),
        };
    } catch {
      return {
        status: "recovery_required",
        headCommit: registeredHead,
        treeHash: null,
        clean: null,
        gitOperationInProgress: null,
        changedPaths: null,
        markerMatched: false,
        processObservation: "unavailable",
        nativeInstanceDigest: digest({ path: input.workspacePath }),
      };
    }
    const coordinates = (
      await git(input.workspacePath, [
        "rev-parse",
        "--path-format=absolute",
        "HEAD",
        "HEAD^{tree}",
        "--git-dir",
      ])
    ).split(/\r?\n/u);
    const [headCommit, treeHash, gitDirectory] = coordinates;
    if (
      coordinates.length !== 3 ||
      !COMMIT.test(headCommit!) ||
      !COMMIT.test(treeHash!) ||
      !isAbsolute(gitDirectory!) ||
      gitDirectory!.includes("\0")
    )
      fail("host_coordinate_invalid", "The Git inspection coordinates are invalid.");
    const [status, operation, matched] = await Promise.all([
      git(input.workspacePath, ["status", "--porcelain=v2", "--untracked-files=normal"]),
      gitOperationInProgress(gitDirectory!),
      this.markerMatches(gitDirectory!, input.marker),
    ]);
    const [changed, untracked] =
      headCommit === input.baseCommit && status.length === 0
        ? ["", ""]
        : await Promise.all([
            git(input.workspacePath, ["diff", "--name-only", "-z", input.baseCommit]),
            git(input.workspacePath, ["ls-files", "--others", "--exclude-standard", "-z"]),
          ]);
    const changedPaths = [
      ...new Set(`${changed}\0${untracked}`.split("\0").filter(Boolean)),
    ].sort();
    return {
      status: matched ? "present" : "recovery_required",
      headCommit: headCommit!,
      treeHash: treeHash!,
      clean: status.length === 0,
      gitOperationInProgress: operation,
      changedPaths,
      markerMatched: matched,
      processObservation: "unavailable",
      nativeInstanceDigest: digest({ path: await realpath(input.workspacePath) }),
    };
  }

  async inspectResult(input: WorkspaceResultInspectionRequest): Promise<WorkspaceResultInspection> {
    const inspection = await this.inspect(input);
    if (inspection.status !== "present" || inspection.headCommit === null)
      return { ...inspection, baseCommitReachable: null, commitIds: null };
    const baseCommitReachable = await gitSucceeds(input.workspacePath, [
      "merge-base",
      "--is-ancestor",
      input.baseCommit,
      inspection.headCommit,
    ]);
    const commitIds = baseCommitReachable
      ? (
          await git(input.workspacePath, [
            "rev-list",
            "--reverse",
            `${input.baseCommit}..${inspection.headCommit}`,
          ])
        )
          .split("\n")
          .filter(Boolean)
      : [];
    return { ...inspection, baseCommitReachable, commitIds };
  }

  async inspectCleanup(
    request: WorkspaceCleanupInspectionRequest,
  ): Promise<WorkspaceCleanupHostInspection> {
    if (
      !/^refs\/(?:heads|tags)\/[A-Za-z0-9._/-]{1,512}$/u.test(request.integrationTargetRef) ||
      !COMMIT.test(request.integratedHeadCommit)
    )
      fail("host_coordinate_invalid", "The Git cleanup target coordinate is invalid.");
    const inspection = await this.inspect(request);
    if (inspection.status === "absent")
      return {
        ...inspection,
        integrationTargetCommit: null,
        headReachableFromTarget: null,
        gitMetadataHash: null,
        dependentReferenceCount: 0,
        childWorkspaceCount: 0,
        reviewLinkCount: 0,
      };
    const targetCommit = await git(request.repositoryRoot, [
      "show-ref",
      "--verify",
      "--hash",
      request.integrationTargetRef,
    ]);
    const worktrees = await registeredWorktrees(request.repositoryRoot);
    return {
      ...inspection,
      integrationTargetCommit: targetCommit,
      headReachableFromTarget: await gitSucceeds(request.repositoryRoot, [
        "merge-base",
        "--is-ancestor",
        request.integratedHeadCommit,
        targetCommit,
      ]),
      gitMetadataHash: digest({
        registeredWorkspacePathDigest: digest({ path: request.workspacePath }),
        registeredHead: worktrees.get(request.workspacePath) ?? null,
        targetCommit,
      }),
      dependentReferenceCount: 0,
      childWorkspaceCount: 0,
      reviewLinkCount: 0,
    };
  }

  async provisionDetached(
    request: WorkspaceProvisionRequest,
    beforeMutation?: () => Promise<void>,
  ): Promise<WorkspaceHostInspection> {
    this.validateRequest(request.repositoryRoot, request.workspacePath, request.marker);
    if (
      !COMMIT.test(request.baseCommit) ||
      !/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey)
    )
      fail("host_coordinate_invalid", "The Git provision binding is invalid.");
    const existing = await this.inspect(request);
    if (existing.status !== "absent") {
      if (existing.markerMatched && existing.headCommit === request.baseCommit) return existing;
      fail("host_effect_uncertain", "A different workspace occupies the provision coordinate.");
    }
    const parentInfo = await lstat(dirname(request.workspacePath));
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
      fail("host_coordinate_invalid", "The workspace parent must be a real directory.");
    await beforeMutation?.();
    await git(request.repositoryRoot, [
      "worktree",
      "add",
      "--detach",
      request.workspacePath,
      request.baseCommit,
    ]);
    try {
      await this.writeMarker(request.workspacePath, request.marker);
    } catch (error) {
      fail("host_effect_uncertain", "The worktree exists without its ownership marker.", error);
    }
    return this.inspect(request);
  }

  async removeNonForce(request: WorkspaceRemovalRequest): Promise<WorkspaceHostInspection> {
    this.validateRequest(request.repositoryRoot, request.workspacePath, request.marker);
    if (!/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey))
      fail("host_coordinate_invalid", "The Git removal binding is invalid.");
    const before = await this.inspect(request);
    if (before.status === "absent") return before;
    if (!before.markerMatched)
      fail("host_marker_mismatch", "The workspace ownership marker changed.");
    if (before.gitOperationInProgress)
      fail("host_operation_in_progress", "A Git operation is in progress.");
    if (!before.clean)
      fail("host_not_clean", "The workspace contains tracked or untracked changes.");
    await git(request.repositoryRoot, ["worktree", "remove", request.workspacePath]);
    const after = await this.inspect(request);
    if (after.status !== "absent")
      fail("host_effect_uncertain", "Git did not prove non-force worktree removal.");
    return after;
  }
}
