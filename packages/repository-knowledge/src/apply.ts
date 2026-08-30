import { lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { sha256 } from "./integrity.js";
import { createKnowledgeMigrationPlan } from "./compiler.js";
import type {
  KnowledgeFileOperation,
  KnowledgeMigrationOperation,
  KnowledgeMaterializationReceipt,
  KnowledgeMigrationPlan,
  RepositoryKnowledgeScanOptions,
} from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

function targetPath(root: string, path: string): string {
  const target = resolve(root, path);
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      `Output path escapes the repository: ${path}`,
    );
  }
  return target;
}

async function assertSafeParent(root: string, target: string): Promise<void> {
  const relativeParent = relative(root, dirname(target));
  let cursor = root;
  for (const part of relativeParent.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    try {
      const stats = await lstat(cursor);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new RepositoryKnowledgeError(
          "knowledge_source_unsafe",
          `${cursor} is not a safe output directory.`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function pruneEmptyParents(root: string, start: string): Promise<void> {
  let parent = start;
  while (parent !== root && relative(root, parent) !== ".lervo") {
    try {
      await rmdir(parent);
    } catch (error) {
      if (["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return;
      throw error;
    }
    parent = dirname(parent);
  }
}

async function currentHash(path: string): Promise<string | null> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new RepositoryKnowledgeError("knowledge_plan_stale", `${path} is not a regular file.`);
    }
    return sha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function preflight(root: string, operation: KnowledgeMigrationOperation): Promise<void> {
  if (operation.action === "conflict") {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      `${operation.path}: ${operation.reason ?? "The operation conflicts with existing user bytes."}`,
    );
  }
  const target = targetPath(root, operation.path);
  await assertSafeParent(root, target);
  const hash = await currentHash(target);
  if (operation.action === "delete") {
    if (hash !== operation.expectedCurrentHash) {
      throw new RepositoryKnowledgeError(
        "knowledge_plan_stale",
        `${operation.path} changed after the plan was created.`,
      );
    }
    return;
  }
  if (operation.action === "create" && hash !== null) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      `${operation.path} was created after the plan was created.`,
    );
  }
  if (
    (operation.action === "update" || operation.action === "unchanged") &&
    hash !== operation.expectedCurrentHash
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      `${operation.path} changed after the plan was created.`,
    );
  }
  if (operation.action === "unchanged" && hash !== operation.desiredHash) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      `${operation.path} has an invalid unchanged disposition.`,
    );
  }
  if (operation.content !== undefined && sha256(operation.content) !== operation.desiredHash) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      `${operation.path} has an invalid planned content hash.`,
    );
  }
}

export async function applyKnowledgeMigrationPlan(
  plan: KnowledgeMigrationPlan,
  now: Date,
  recordApplied: (receipt: KnowledgeMaterializationReceipt) => void | Promise<void>,
  options: RepositoryKnowledgeScanOptions = {},
): Promise<KnowledgeMaterializationReceipt> {
  if (plan.schemaVersion !== 1 || plan.status !== "ready") {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The repository knowledge plan is not applicable.",
    );
  }
  const root = resolve(plan.repositoryRoot);
  const currentPlan = await createKnowledgeMigrationPlan({
    repositoryRoot: root,
    mode: plan.mode,
    repairMode: plan.repairMode,
    reconciliationMode: plan.reconciliation.strategy,
    supplementalSources: options.supplementalSources,
  });
  if (currentPlan.planId !== plan.planId) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The source, policy, compiler output, or target changed after planning. Create a new read-only plan.",
    );
  }
  for (const operation of plan.operations) await preflight(root, operation);

  const changed = plan.operations.filter(
    (operation) =>
      operation.action === "create" ||
      operation.action === "update" ||
      operation.action === "delete",
  );
  const stagingParent = resolve(root, ".lervo/state/knowledge");
  await mkdir(stagingParent, { recursive: true });
  const staging = await mkdtemp(resolve(stagingParent, "apply-"));
  const installed: Array<{
    operation: KnowledgeMigrationOperation;
    target: string;
    backup: string | null;
  }> = [];
  const receipt: KnowledgeMaterializationReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    planId: plan.planId,
    projectId: plan.projectId,
    sourceSnapshotId: plan.sourceSnapshotId,
    appliedAt: now.toISOString(),
    created: plan.operations
      .filter((operation) => operation.action === "create")
      .map((operation) => operation.path),
    updated: plan.operations
      .filter((operation) => operation.action === "update")
      .map((operation) => operation.path),
    unchanged: plan.operations
      .filter((operation) => operation.action === "unchanged")
      .map((operation) => operation.path),
    deleted: plan.operations
      .filter((operation) => operation.action === "delete")
      .map((operation) => operation.path),
  };
  try {
    for (const operation of changed) {
      if (operation.action === "delete") continue;
      if (operation.content === undefined) {
        throw new RepositoryKnowledgeError(
          "knowledge_plan_stale",
          `${operation.path} has no content to apply.`,
        );
      }
      const staged = resolve(staging, "new", operation.path);
      await mkdir(dirname(staged), { recursive: true });
      await writeFile(staged, operation.content, { encoding: "utf8", flag: "wx" });
    }
    for (const operation of changed) {
      const target = targetPath(root, operation.path);
      await assertSafeParent(root, target);
      if (operation.action !== "delete") await mkdir(dirname(target), { recursive: true });
      const staged = operation.action === "delete" ? null : resolve(staging, "new", operation.path);
      let backup: string | null = null;
      if (operation.action === "update" || operation.action === "delete") {
        backup = resolve(staging, "backup", operation.path);
        await mkdir(dirname(backup), { recursive: true });
        await rename(target, backup);
      }
      try {
        if (staged !== null) await rename(staged, target);
      } catch (error) {
        if (backup !== null) await rename(backup, target).catch(() => undefined);
        throw error;
      }
      installed.push({ operation, target, backup });
    }
    await recordApplied(receipt);
    for (const operation of changed.filter((item) => item.action === "delete")) {
      let parent = dirname(targetPath(root, operation.path));
      while (parent !== root && relative(root, parent) !== ".lervo") {
        try {
          await rmdir(parent);
        } catch {
          break;
        }
        parent = dirname(parent);
      }
    }
  } catch (error) {
    for (const item of installed.reverse()) {
      await rm(item.target, { force: true });
      if (item.backup !== null) await rename(item.backup, item.target).catch(() => undefined);
      else await pruneEmptyParents(root, dirname(item.target));
    }
    throw error instanceof RepositoryKnowledgeError
      ? error
      : new RepositoryKnowledgeError(
          "knowledge_apply_failed",
          error instanceof Error ? error.message : String(error),
        );
  } finally {
    await rm(staging, { recursive: true, force: true });
    await pruneEmptyParents(root, stagingParent);
  }

  return receipt;
}

export async function applyKnowledgeFileOperations<T>(input: {
  repositoryRoot: string;
  operations: KnowledgeFileOperation[];
  receipt: T;
  recordApplied: (receipt: T) => void | Promise<void>;
}): Promise<T> {
  const root = resolve(input.repositoryRoot);
  for (const operation of input.operations) await preflight(root, operation);
  const changed = input.operations.filter(
    (operation) => operation.action === "create" || operation.action === "update",
  );
  const stagingParent = resolve(root, ".lervo/state/knowledge");
  await mkdir(stagingParent, { recursive: true });
  const staging = await mkdtemp(resolve(stagingParent, "apply-"));
  const installed: Array<{
    operation: KnowledgeFileOperation;
    target: string;
    backup: string | null;
  }> = [];
  try {
    for (const operation of changed) {
      if (operation.content === undefined)
        throw new RepositoryKnowledgeError(
          "knowledge_plan_stale",
          `${operation.path} has no content to apply.`,
        );
      const staged = resolve(staging, "new", operation.path);
      await mkdir(dirname(staged), { recursive: true });
      await writeFile(staged, operation.content, { encoding: "utf8", flag: "wx" });
    }
    for (const operation of changed) {
      const target = targetPath(root, operation.path);
      await assertSafeParent(root, target);
      await mkdir(dirname(target), { recursive: true });
      const staged = resolve(staging, "new", operation.path);
      let backup: string | null = null;
      if (operation.action === "update") {
        backup = resolve(staging, "backup", operation.path);
        await mkdir(dirname(backup), { recursive: true });
        await rename(target, backup);
      }
      try {
        await rename(staged, target);
      } catch (error) {
        if (backup !== null) await rename(backup, target).catch(() => undefined);
        throw error;
      }
      installed.push({ operation, target, backup });
    }
    await input.recordApplied(input.receipt);
    return input.receipt;
  } catch (error) {
    for (const item of installed.reverse()) {
      await rm(item.target, { force: true });
      if (item.backup !== null) await rename(item.backup, item.target).catch(() => undefined);
      else await pruneEmptyParents(root, dirname(item.target));
    }
    throw error instanceof RepositoryKnowledgeError
      ? error
      : new RepositoryKnowledgeError(
          "knowledge_apply_failed",
          error instanceof Error ? error.message : String(error),
        );
  } finally {
    await rm(staging, { recursive: true, force: true });
    await pruneEmptyParents(root, stagingParent);
  }
}
