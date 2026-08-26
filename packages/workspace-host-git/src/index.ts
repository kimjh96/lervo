import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import {
  WorkspaceHostError,
  type WorkspaceHostAdapter,
  type WorkspaceHostInspection,
  type WorkspaceInspectionRequest,
  type WorkspaceOwnershipMarker,
  type WorkspaceProvisionRequest,
  type WorkspaceRemovalRequest,
} from "@lervo/workspace-host";

const execute = promisify(execFile);
const COMMIT = /^[a-f0-9]{40,64}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const MARKER_NAME = "lervo-workspace-owner.json";
const VERSION = "1.0.0";

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

function validMarker(marker: WorkspaceOwnershipMarker): boolean {
  return (
    marker.schemaVersion === 1 &&
    /^wsp_[a-f0-9]{24}$/u.test(marker.workspaceId) &&
    Number.isSafeInteger(marker.generation) &&
    marker.generation >= 1 &&
    /^rpi_[a-f0-9]{24}$/u.test(marker.repositoryInstanceId) &&
    marker.adapterKind === "git" &&
    marker.adapterVersion === VERSION &&
    /^wpl_[a-f0-9]{24}$/u.test(marker.creationPlanId) &&
    HASH.test(marker.pathDigest)
  );
}

function validateRequest(
  repositoryRoot: string,
  workspacePath: string,
  marker: WorkspaceOwnershipMarker,
  allowSamePath = false,
) {
  if (
    !isAbsolute(repositoryRoot) ||
    !isAbsolute(workspacePath) ||
    resolve(repositoryRoot) !== repositoryRoot ||
    resolve(workspacePath) !== workspacePath ||
    (!allowSamePath && repositoryRoot === workspacePath) ||
    !validMarker(marker)
  )
    fail("host_coordinate_invalid", "The Git workspace coordinate is invalid.");
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

async function markerMatches(workspacePath: string, expected: WorkspaceOwnershipMarker) {
  try {
    const gitDirectory = await git(workspacePath, [
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
    ]);
    const path = resolve(gitDirectory, MARKER_NAME);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) return false;
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return stableJson(value) === stableJson(expected);
  } catch {
    return false;
  }
}

async function gitOperationInProgress(workspacePath: string): Promise<boolean> {
  const gitDirectory = await git(workspacePath, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
  ]);
  const names = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
    "rebase-merge",
    "rebase-apply",
  ];
  for (const name of names) {
    try {
      await lstat(resolve(gitDirectory, name));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return true;
    }
  }
  return false;
}

async function inspectGitWorkspace(input: {
  repositoryRoot: string;
  workspacePath: string;
  baseCommit: string;
  marker: WorkspaceOwnershipMarker;
}): Promise<WorkspaceHostInspection> {
  validateRequest(input.repositoryRoot, input.workspacePath, input.marker, true);
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
        nativeInstanceDigest: digest({ path: input.workspacePath, head: registeredHead }),
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
      nativeInstanceDigest: digest({ path: input.workspacePath, head: registeredHead }),
    };
  }
  const [headCommit, treeHash, status, operation, matched, changed, untracked] = await Promise.all([
    git(input.workspacePath, ["rev-parse", "HEAD"]),
    git(input.workspacePath, ["rev-parse", "HEAD^{tree}"]),
    git(input.workspacePath, ["status", "--porcelain=v2", "--untracked-files=normal"]),
    gitOperationInProgress(input.workspacePath),
    markerMatches(input.workspacePath, input.marker),
    git(input.workspacePath, ["diff", "--name-only", "-z", input.baseCommit]),
    git(input.workspacePath, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const changedPaths = [...new Set(`${changed}\0${untracked}`.split("\0").filter(Boolean))].sort();
  return {
    status: matched ? "present" : "recovery_required",
    headCommit,
    treeHash,
    clean: status.length === 0,
    gitOperationInProgress: operation,
    changedPaths,
    markerMatched: matched,
    processObservation: "unavailable",
    nativeInstanceDigest: digest({ path: await realpath(input.workspacePath), head: headCommit }),
  };
}

async function writeMarker(workspacePath: string, marker: WorkspaceOwnershipMarker): Promise<void> {
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

export class GitWorkspaceHostAdapter implements WorkspaceHostAdapter {
  readonly kind = "git" as const;
  readonly version = VERSION;
  readonly capabilities = {
    provision: true,
    inspect: true,
    nonForceRemoval: true,
    processObservation: false,
  } as const;

  async provision(request: WorkspaceProvisionRequest): Promise<WorkspaceHostInspection> {
    validateRequest(request.repositoryRoot, request.workspacePath, request.marker);
    if (
      !COMMIT.test(request.baseCommit) ||
      !/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey)
    )
      fail("host_coordinate_invalid", "The Git provision binding is invalid.");
    const existing = await inspectGitWorkspace(request);
    if (existing.status !== "absent") {
      if (existing.markerMatched && existing.headCommit === request.baseCommit) return existing;
      fail(
        "host_effect_uncertain",
        "A different workspace already occupies the provision coordinate.",
      );
    }
    const parent = dirname(request.workspacePath);
    const parentInfo = await lstat(parent);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
      fail("host_coordinate_invalid", "The workspace parent must be a real directory.");
    await git(request.repositoryRoot, [
      "worktree",
      "add",
      "--detach",
      request.workspacePath,
      request.baseCommit,
    ]);
    try {
      await writeMarker(request.workspacePath, request.marker);
    } catch (error) {
      fail(
        "host_effect_uncertain",
        "The worktree exists but its ownership marker was not committed.",
        error,
      );
    }
    return inspectGitWorkspace(request);
  }

  inspect(request: WorkspaceInspectionRequest) {
    return inspectGitWorkspace(request);
  }

  async remove(request: WorkspaceRemovalRequest): Promise<WorkspaceHostInspection> {
    validateRequest(request.repositoryRoot, request.workspacePath, request.marker);
    if (!/^idk_[A-Za-z0-9_-]{8,128}$/u.test(request.idempotencyKey))
      fail("host_coordinate_invalid", "The Git removal binding is invalid.");
    const before = await inspectGitWorkspace(request);
    if (before.status === "absent") return before;
    if (!before.markerMatched)
      fail("host_marker_mismatch", "The workspace ownership marker changed.");
    if (before.gitOperationInProgress)
      fail("host_operation_in_progress", "A Git operation is in progress.");
    if (!before.clean)
      fail("host_not_clean", "The workspace contains tracked or untracked changes.");
    await git(request.repositoryRoot, ["worktree", "remove", request.workspacePath]);
    const after = await inspectGitWorkspace(request);
    if (after.status !== "absent")
      fail("host_effect_uncertain", "Git did not prove complete non-force worktree removal.");
    return after;
  }
}
