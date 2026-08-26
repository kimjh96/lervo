import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  OrcaCliWorkspaceClient,
  OrcaWorkspaceHostAdapter,
  type OrcaCommandRunner,
  type OrcaWorkspaceClient,
  type OrcaWorkspaceSummary,
} from "../src/index.js";

const execute = promisify(execFile);
const roots: string[] = [];
const marker = {
  schemaVersion: 1 as const,
  workspaceId: "wsp_0123456789abcdef01234567",
  generation: 1,
  repositoryInstanceId: "rpi_0123456789abcdef01234567",
  adapterKind: "orca" as const,
  adapterVersion: "1.0.0",
  creationPlanId: "wpl_0123456789abcdef01234567",
  pathDigest: `sha256:${"a".repeat(64)}`,
};

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...arguments_]);
  return stdout.trim();
}

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-orca-host-"));
  const parent = await mkdtemp(resolve(tmpdir(), "lervo-orca-host-parent-"));
  roots.push(root, parent);
  await execute("git", ["-C", root, "init", "-b", "main"]);
  await git(root, "config", "user.email", "lervo-test@example.invalid");
  await git(root, "config", "user.name", "Lervo Test");
  await writeFile(resolve(root, "tracked.txt"), "base\n");
  await git(root, "add", "tracked.txt");
  await git(root, "commit", "-m", "fixture");
  return {
    repositoryRoot: root,
    workspacePath: resolve(parent, "worker"),
    baseCommit: await git(root, "rev-parse", "HEAD"),
  };
}

class FakeOrcaClient implements OrcaWorkspaceClient {
  readonly lifecycle: Array<{ status: string; comment: string }> = [];
  readonly worktrees: OrcaWorkspaceSummary[] = [];
  terminalTotal = 0;

  constructor(private readonly workspacePath: string) {}

  async list(): Promise<OrcaWorkspaceSummary[]> {
    return structuredClone(this.worktrees);
  }

  async create(input: { repositoryRoot: string; name: string; baseCommit: string }) {
    await git(
      input.repositoryRoot,
      "worktree",
      "add",
      "--detach",
      this.workspacePath,
      input.baseCommit,
    );
    const worktree: OrcaWorkspaceSummary = {
      id: `repo_fixture::${this.workspacePath}`,
      path: this.workspacePath,
      head: input.baseCommit,
      workspaceStatus: "todo",
      parentWorktreeId: null,
      childWorktreeIds: [],
      linkedPR: null,
      linkedGitLabMR: null,
      linkedBitbucketPR: null,
      linkedAzureDevOpsPR: null,
      linkedGiteaPR: null,
    };
    this.worktrees.push(worktree);
    return { id: worktree.id, path: worktree.path };
  }

  async terminalCount(): Promise<number> {
    return this.terminalTotal;
  }

  async setLifecycle(input: {
    status: "in-progress" | "in-review" | "completed";
    comment: string;
  }) {
    this.lifecycle.push(input);
  }

  async removeNonForce(): Promise<void> {
    const current = this.worktrees[0]!;
    await git(current.path, "status", "--porcelain=v2", "--untracked-files=normal");
    await git(current.path, "rev-parse", "HEAD");
    await git(current.path, "worktree", "remove", current.path);
    this.worktrees.splice(0);
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Orca workspace host adapter", () => {
  it("keeps Orca optional while adding exact terminal and visible lifecycle evidence", async () => {
    const fixture = await repository();
    const client = new FakeOrcaClient(fixture.workspacePath);
    const adapter = new OrcaWorkspaceHostAdapter(client);
    const request = {
      ...fixture,
      marker,
      idempotencyKey: "idk_orca_provision_001",
    };
    expect(await adapter.provision(request)).toMatchObject({
      status: "present",
      processObservation: "quiescent",
      markerMatched: true,
    });
    expect(client.lifecycle).toMatchObject([
      {
        status: "in-progress",
        comment: "Lervo workspace ready; one managed writer may start.",
      },
    ]);

    client.terminalTotal = 1;
    expect(await adapter.inspect(request)).toMatchObject({ processObservation: "live" });
    await expect(
      adapter.remove({ ...request, idempotencyKey: "idk_orca_remove_0001" }),
    ).rejects.toMatchObject({ code: "host_effect_uncertain" });

    client.terminalTotal = 0;
    expect(
      await adapter.inspectCleanup({
        ...fixture,
        marker,
        integrationTargetRef: "refs/heads/main",
        integratedHeadCommit: fixture.baseCommit,
      }),
    ).toMatchObject({
      processObservation: "quiescent",
      childWorkspaceCount: 0,
      reviewLinkCount: 0,
      headReachableFromTarget: true,
    });
    expect(
      await adapter.remove({ ...request, idempotencyKey: "idk_orca_remove_0002" }),
    ).toMatchObject({ status: "absent" });
    expect(client.lifecycle.at(-1)).toMatchObject({
      status: "in-review",
      comment: "Lervo cleanup verified quiescence; non-force removal is in progress.",
    });
  });

  it("uses only public Orca CLI commands and omits force during removal", async () => {
    const calls: string[][] = [];
    const runner: OrcaCommandRunner = {
      run: async (arguments_) => {
        calls.push(arguments_);
        if (arguments_[0] === "worktree" && arguments_[1] === "list") return { worktrees: [] };
        if (arguments_[0] === "terminal") return { totalCount: 0 };
        return {};
      },
    };
    const client = new OrcaCliWorkspaceClient(runner);
    await client.list("/repo");
    await client.terminalCount("repo::/workspace");
    await client.setLifecycle({
      worktreeId: "repo::/workspace",
      status: "in-review",
      comment: "cleanup",
    });
    await client.removeNonForce("repo::/workspace");
    expect(calls.at(-1)).toEqual(["worktree", "rm", "--worktree", "id:repo::/workspace"]);
    expect(calls.flat()).not.toContain("--force");
  });
});
