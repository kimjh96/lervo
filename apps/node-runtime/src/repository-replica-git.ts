import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertRepositoryReplicaSnapshot,
  calculateRepositoryReplicaSnapshotHash,
  type RepositoryReplicaSnapshot,
} from "@lervo/sync";

const MAXIMUM_GIT_OUTPUT_BYTES = 512 * 1024 * 1024;
const EXPORT_REF = "refs/lervo/replica/export";
const INCOMING_REF = "refs/lervo/replica/incoming";
const FIXED_GIT_ENVIRONMENT = {
  GIT_AUTHOR_NAME: "Lervo Repository Replica",
  GIT_AUTHOR_EMAIL: "repository-replica@lervo.local",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Lervo Repository Replica",
  GIT_COMMITTER_EMAIL: "repository-replica@lervo.local",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};

export class RepositoryReplicaGitError extends Error {
  constructor(
    readonly code:
      | "repository_replica_snapshot_failed"
      | "repository_replica_bundle_failed"
      | "repository_replica_conflict"
      | "repository_replica_apply_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryReplicaGitError";
  }
}

interface GitResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

async function git(
  repositoryRoot: string,
  args: readonly string[],
  options: {
    input?: Uint8Array | string;
    environment?: NodeJS.ProcessEnv;
    allowedExitCodes?: number[];
  } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repositoryRoot, ...args], {
      env: { ...process.env, ...options.environment },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let byteCount = 0;
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      byteCount += chunk.byteLength;
      if (byteCount > MAXIMUM_GIT_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        reject(new Error("Git output exceeded the repository replica bound."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    child.once("close", (exitCode) => {
      const code = exitCode ?? 1;
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode: code,
      };
      if (!(options.allowedExitCodes ?? [0]).includes(code)) {
        reject(new Error(`Git exited with ${code}: ${result.stderr.toString("utf8").trim()}`));
        return;
      }
      resolve(result);
    });
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });
}

function text(result: GitResult): string {
  return result.stdout.toString("utf8").trim();
}

function snapshotSource(snapshot: RepositoryReplicaSnapshot): string {
  return `${JSON.stringify(snapshot)}\n`;
}

async function createExportCommit(
  repositoryRoot: string,
  snapshot: RepositoryReplicaSnapshot,
): Promise<void> {
  const environment = FIXED_GIT_ENVIRONMENT;
  const indexCommit = text(
    await git(repositoryRoot, ["commit-tree", snapshot.indexTree, "-p", snapshot.head], {
      input: `lervo-repository-replica-index-v1\n${snapshotSource(snapshot)}`,
      environment,
    }),
  );
  const worktreeCommit = text(
    await git(
      repositoryRoot,
      ["commit-tree", snapshot.worktreeTree, "-p", snapshot.head, "-p", indexCommit],
      {
        input: `lervo-repository-replica-worktree-v1\n${snapshotSource(snapshot)}`,
        environment,
      },
    ),
  );
  await git(repositoryRoot, ["update-ref", EXPORT_REF, worktreeCommit]);
}

export async function captureRepositoryReplicaSnapshot(
  repositoryRoot: string,
): Promise<RepositoryReplicaSnapshot> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lervo-repository-replica-"));
  const temporaryIndex = join(temporaryDirectory, "index");
  try {
    const head = text(await git(repositoryRoot, ["rev-parse", "HEAD"]));
    const branchResult = await git(repositoryRoot, ["symbolic-ref", "--short", "HEAD"], {
      allowedExitCodes: [0, 1],
    });
    const branch = branchResult.exitCode === 0 ? text(branchResult) : null;
    const environment = { GIT_INDEX_FILE: temporaryIndex };
    const indexPath = text(
      await git(repositoryRoot, ["rev-parse", "--path-format=absolute", "--git-path", "index"]),
    );
    try {
      await copyFile(indexPath, temporaryIndex);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await git(repositoryRoot, ["read-tree", "--empty"], { environment });
    }
    const indexTree = text(await git(repositoryRoot, ["write-tree"], { environment }));
    await git(repositoryRoot, ["read-tree", "HEAD"], { environment });
    await git(repositoryRoot, ["add", "-A", "--", "."], { environment });
    const worktreeTree = text(await git(repositoryRoot, ["write-tree"], { environment }));
    const source = { schemaVersion: 1 as const, head, branch, indexTree, worktreeTree };
    const snapshot: RepositoryReplicaSnapshot = {
      ...source,
      snapshotHash: calculateRepositoryReplicaSnapshotHash(source),
    };
    assertRepositoryReplicaSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (error instanceof RepositoryReplicaGitError) throw error;
    throw new RepositoryReplicaGitError(
      "repository_replica_snapshot_failed",
      "The exact repository replica snapshot could not be captured.",
      { cause: error },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function createRepositoryReplicaBundle(repositoryRoot: string): Promise<Uint8Array> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lervo-repository-bundle-"));
  const bundlePath = join(temporaryDirectory, "replica.bundle");
  try {
    const snapshot = await captureRepositoryReplicaSnapshot(repositoryRoot);
    await createExportCommit(repositoryRoot, snapshot);
    await git(repositoryRoot, ["bundle", "create", bundlePath, EXPORT_REF]);
    return new Uint8Array(await readFile(bundlePath));
  } catch (error) {
    if (error instanceof RepositoryReplicaGitError) throw error;
    throw new RepositoryReplicaGitError(
      "repository_replica_bundle_failed",
      "The repository replica bundle could not be created.",
      { cause: error },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function isAncestor(repositoryRoot: string, ancestor: string, descendant: string) {
  return (
    (
      await git(repositoryRoot, ["merge-base", "--is-ancestor", ancestor, descendant], {
        allowedExitCodes: [0, 1],
      })
    ).exitCode === 0
  );
}

async function applyTrees(
  repositoryRoot: string,
  current: RepositoryReplicaSnapshot,
  desired: RepositoryReplicaSnapshot,
  allowHistoryReplacement = false,
): Promise<void> {
  const historyChanged = current.head !== desired.head;
  const branchChanged = current.branch !== desired.branch;
  if (historyChanged || branchChanged) {
    const fastForward =
      historyChanged &&
      current.branch !== null &&
      desired.branch === current.branch &&
      (await isAncestor(repositoryRoot, current.head, desired.head));
    if (!allowHistoryReplacement && !fastForward) {
      throw new RepositoryReplicaGitError(
        "repository_replica_conflict",
        "Repository replica history is detached, rewound, or divergent.",
      );
    }
    if (allowHistoryReplacement) {
      await createExportCommit(repositoryRoot, current);
      await git(repositoryRoot, [
        "update-ref",
        `refs/lervo/replica/recovery/${current.snapshotHash.slice("sha256:".length)}`,
        EXPORT_REF,
      ]);
      if (desired.branch === null) {
        await git(repositoryRoot, ["symbolic-ref", "--delete", "HEAD"], {
          allowedExitCodes: [0, 1],
        });
        await git(repositoryRoot, ["update-ref", "HEAD", desired.head]);
      } else {
        await git(repositoryRoot, ["update-ref", `refs/heads/${desired.branch}`, desired.head]);
        await git(repositoryRoot, ["symbolic-ref", "HEAD", `refs/heads/${desired.branch}`]);
      }
    } else {
      await git(repositoryRoot, [
        "update-ref",
        `refs/heads/${current.branch}`,
        desired.head,
        current.head,
      ]);
    }
  }
  await git(repositoryRoot, ["reset", "--hard", desired.head]);
  await git(repositoryRoot, ["clean", "-fd"]);
  await git(repositoryRoot, ["read-tree", desired.indexTree]);
  await git(repositoryRoot, ["checkout-index", "--all", "--force"]);
  const patch = (
    await git(repositoryRoot, [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      desired.indexTree,
      desired.worktreeTree,
    ])
  ).stdout;
  if (patch.byteLength > 0) {
    await git(repositoryRoot, ["apply", "--binary", "--whitespace=nowarn"], { input: patch });
  }
}

function parseIncomingSnapshot(message: string): RepositoryReplicaSnapshot {
  const lines = message.trim().split("\n");
  if (lines[0] !== "lervo-repository-replica-worktree-v1" || lines[1] === undefined) {
    throw new Error("The incoming repository replica commit has no supported envelope.");
  }
  const snapshot = JSON.parse(lines[1]) as RepositoryReplicaSnapshot;
  assertRepositoryReplicaSnapshot(snapshot);
  return snapshot;
}

async function verifyIncomingCommit(
  repositoryRoot: string,
  snapshot: RepositoryReplicaSnapshot,
): Promise<void> {
  const commit = text(await git(repositoryRoot, ["rev-parse", `${INCOMING_REF}^{commit}`]));
  const [worktreeTree, parents, message] = await Promise.all([
    git(repositoryRoot, ["show", "-s", "--format=%T", commit]).then(text),
    git(repositoryRoot, ["show", "-s", "--format=%P", commit]).then(text),
    git(repositoryRoot, ["show", "-s", "--format=%B", commit]).then((value) =>
      value.stdout.toString("utf8"),
    ),
  ]);
  const [head, indexCommit, ...additionalParents] = parents.split(" ");
  if (
    worktreeTree !== snapshot.worktreeTree ||
    head !== snapshot.head ||
    indexCommit === undefined ||
    additionalParents.length > 0 ||
    parseIncomingSnapshot(message).snapshotHash !== snapshot.snapshotHash ||
    text(await git(repositoryRoot, ["show", "-s", "--format=%T", indexCommit])) !==
      snapshot.indexTree
  ) {
    throw new Error("The incoming repository replica Git objects differ from their envelope.");
  }
}

export async function applyRepositoryReplicaBundle(input: {
  repositoryRoot: string;
  bundle: Uint8Array;
  expectedCurrentSnapshotHash: string;
  allowHistoryReplacement?: boolean;
}): Promise<RepositoryReplicaSnapshot> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "lervo-repository-import-"));
  const bundlePath = join(temporaryDirectory, "replica.bundle");
  let current: RepositoryReplicaSnapshot | null = null;
  try {
    current = await captureRepositoryReplicaSnapshot(input.repositoryRoot);
    if (current.snapshotHash !== input.expectedCurrentSnapshotHash) {
      throw new RepositoryReplicaGitError(
        "repository_replica_conflict",
        `The repository changed after replica reconciliation (${current.snapshotHash} != ${input.expectedCurrentSnapshotHash}).`,
      );
    }
    await writeFile(bundlePath, input.bundle, { mode: 0o600 });
    await git(input.repositoryRoot, ["bundle", "verify", bundlePath]);
    await git(input.repositoryRoot, [
      "fetch",
      "--no-tags",
      bundlePath,
      `+${EXPORT_REF}:${INCOMING_REF}`,
    ]);
    const message = (
      await git(input.repositoryRoot, ["show", "-s", "--format=%B", INCOMING_REF])
    ).stdout.toString("utf8");
    const desired = parseIncomingSnapshot(message);
    await verifyIncomingCommit(input.repositoryRoot, desired);
    await applyTrees(
      input.repositoryRoot,
      current,
      desired,
      input.allowHistoryReplacement === true,
    );
    const applied = await captureRepositoryReplicaSnapshot(input.repositoryRoot);
    if (applied.snapshotHash !== desired.snapshotHash) {
      throw new Error("The applied repository replica differs from the source snapshot.");
    }
    return applied;
  } catch (error) {
    if (
      current !== null &&
      !(error instanceof RepositoryReplicaGitError && error.code === "repository_replica_conflict")
    ) {
      try {
        const observed = await captureRepositoryReplicaSnapshot(input.repositoryRoot);
        if (
          observed.head !== current.head &&
          observed.branch === current.branch &&
          current.branch !== null
        ) {
          await git(input.repositoryRoot, [
            "update-ref",
            `refs/heads/${current.branch}`,
            current.head,
            observed.head,
          ]);
        }
        await applyTrees(input.repositoryRoot, { ...observed, head: current.head }, current);
      } catch {
        throw new RepositoryReplicaGitError(
          "repository_replica_apply_failed",
          "Repository replica apply failed and automatic rollback could not be proven.",
          { cause: error },
        );
      }
    }
    if (error instanceof RepositoryReplicaGitError) throw error;
    throw new RepositoryReplicaGitError(
      "repository_replica_apply_failed",
      "The repository replica bundle could not be applied.",
      { cause: error },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function repositoryReplicaBundleDigest(bundle: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bundle).digest("hex")}`;
}
