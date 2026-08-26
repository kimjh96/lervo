import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { WorkspaceHostError } from "@lervo/workspace-host";

const execute = promisify(execFile);

export interface OrcaWorkspaceSummary {
  id: string;
  path: string;
  head: string;
  workspaceStatus: string;
  parentWorktreeId: string | null;
  childWorktreeIds: string[];
  linkedPR: number | null;
  linkedGitLabMR: number | null;
  linkedBitbucketPR: number | null;
  linkedAzureDevOpsPR: number | null;
  linkedGiteaPR: number | null;
}

export interface OrcaWorkspaceCreateResult {
  id: string;
  path: string;
}

export interface OrcaWorkspaceClient {
  list(repositoryRoot: string): Promise<OrcaWorkspaceSummary[]>;
  create(input: {
    repositoryRoot: string;
    name: string;
    baseCommit: string;
  }): Promise<OrcaWorkspaceCreateResult>;
  terminalCount(worktreeId: string): Promise<number | null>;
  setLifecycle(input: {
    worktreeId: string;
    status: "in-progress" | "in-review" | "completed";
    comment: string;
  }): Promise<void>;
  removeNonForce(worktreeId: string): Promise<void>;
}

interface OrcaEnvelope {
  ok: boolean;
  result?: unknown;
}

export interface OrcaCommandRunner {
  run(arguments_: string[]): Promise<unknown>;
}

export class OrcaCliCommandRunner implements OrcaCommandRunner {
  constructor(private readonly executable = process.env.ORCA_CLI_COMMAND ?? "orca") {
    if (this.executable.length === 0 || /[\0\r\n]/u.test(this.executable))
      throw new WorkspaceHostError(
        "host_coordinate_invalid",
        "The Orca CLI executable is invalid.",
      );
  }

  async run(arguments_: string[]): Promise<unknown> {
    try {
      const { stdout } = await execute(this.executable, [...arguments_, "--json"], {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      });
      const envelope = JSON.parse(stdout) as OrcaEnvelope;
      if (!envelope.ok || envelope.result === undefined)
        throw new Error("The Orca CLI returned an unsuccessful envelope.");
      return envelope.result;
    } catch (error) {
      throw new WorkspaceHostError("host_effect_uncertain", "The Orca CLI call failed.", {
        cause: error,
      });
    }
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new WorkspaceHostError("host_effect_uncertain", `The Orca ${label} is invalid.`);
  return value as Record<string, unknown>;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function summary(value: unknown): OrcaWorkspaceSummary {
  const item = object(value, "worktree summary");
  if (
    typeof item.id !== "string" ||
    typeof item.path !== "string" ||
    typeof item.head !== "string" ||
    typeof item.workspaceStatus !== "string" ||
    !Array.isArray(item.childWorktreeIds) ||
    !item.childWorktreeIds.every((id) => typeof id === "string")
  )
    throw new WorkspaceHostError("host_effect_uncertain", "The Orca worktree fields are invalid.");
  return {
    id: item.id,
    path: item.path,
    head: item.head,
    workspaceStatus: item.workspaceStatus,
    parentWorktreeId: typeof item.parentWorktreeId === "string" ? item.parentWorktreeId : null,
    childWorktreeIds: item.childWorktreeIds,
    linkedPR: optionalNumber(item.linkedPR),
    linkedGitLabMR: optionalNumber(item.linkedGitLabMR),
    linkedBitbucketPR: optionalNumber(item.linkedBitbucketPR),
    linkedAzureDevOpsPR: optionalNumber(item.linkedAzureDevOpsPR),
    linkedGiteaPR: optionalNumber(item.linkedGiteaPR),
  };
}

export class OrcaCliWorkspaceClient implements OrcaWorkspaceClient {
  constructor(private readonly runner: OrcaCommandRunner = new OrcaCliCommandRunner()) {}

  async list(repositoryRoot: string): Promise<OrcaWorkspaceSummary[]> {
    const result = object(
      await this.runner.run(["worktree", "list", "--repo", `path:${repositoryRoot}`]),
      "worktree list",
    );
    if (!Array.isArray(result.worktrees))
      throw new WorkspaceHostError("host_effect_uncertain", "The Orca worktree list is invalid.");
    return result.worktrees.map(summary);
  }

  async create(input: {
    repositoryRoot: string;
    name: string;
    baseCommit: string;
  }): Promise<OrcaWorkspaceCreateResult> {
    const result = object(
      await this.runner.run([
        "worktree",
        "create",
        "--repo",
        `path:${input.repositoryRoot}`,
        "--name",
        input.name,
        "--base-branch",
        input.baseCommit,
        "--no-parent",
        "--setup",
        "skip",
      ]),
      "worktree creation",
    );
    const worktree = object(result.worktree, "created worktree");
    if (typeof worktree.id !== "string" || typeof worktree.path !== "string")
      throw new WorkspaceHostError(
        "host_effect_uncertain",
        "The created Orca worktree is invalid.",
      );
    return { id: worktree.id, path: worktree.path };
  }

  async terminalCount(worktreeId: string): Promise<number | null> {
    try {
      const result = object(
        await this.runner.run(["terminal", "list", "--worktree", `id:${worktreeId}`]),
        "terminal list",
      );
      return typeof result.totalCount === "number" && Number.isSafeInteger(result.totalCount)
        ? result.totalCount
        : null;
    } catch {
      return null;
    }
  }

  async setLifecycle(input: {
    worktreeId: string;
    status: "in-progress" | "in-review" | "completed";
    comment: string;
  }): Promise<void> {
    await this.runner.run([
      "worktree",
      "set",
      "--worktree",
      `id:${input.worktreeId}`,
      "--workspace-status",
      input.status,
      "--comment",
      input.comment,
    ]);
  }

  async removeNonForce(worktreeId: string): Promise<void> {
    await this.runner.run(["worktree", "rm", "--worktree", `id:${worktreeId}`]);
  }
}
