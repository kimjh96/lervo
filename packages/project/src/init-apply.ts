import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { contentHash, readEntry } from "./filesystem.js";
import { lervoRelativePaths } from "./layout.js";
import {
  type InitApplyResult,
  type InitOperation,
  type InitPlan,
  LervoProjectError,
} from "./types.js";

function resolveManagedPath(root: string, path: string): string {
  const lervoRoot = resolve(root, lervoRelativePaths.root);
  const target = resolve(root, path);
  const fromLervoRoot = relative(lervoRoot, target);
  if (fromLervoRoot === "" || (!fromLervoRoot.startsWith(`..${sep}`) && fromLervoRoot !== "..")) {
    return target;
  }
  throw new LervoProjectError("unsafe_path", `The path is not managed by the initialization plan: ${path}`);
}

async function preflightOperation(root: string, operation: InitOperation): Promise<void> {
  const entry = await readEntry(resolveManagedPath(root, operation.path));
  if (operation.action === "create") {
    if (entry.kind !== "missing") {
      throw new LervoProjectError(
        "plan_stale",
        `${operation.path} was created after the plan was generated. Run the dry run again.`,
      );
    }
    return;
  }
  if (operation.action === "conflict") {
    throw new LervoProjectError("init_conflict", operation.reason);
  }
  if (operation.kind === "directory") {
    if (entry.kind !== "directory") {
      throw new LervoProjectError("plan_stale", `${operation.path} changed after the plan was generated.`);
    }
    return;
  }
  if (entry.kind !== "file" || contentHash(entry.content) !== operation.expectedContentHash) {
    throw new LervoProjectError("plan_stale", `${operation.path} changed after the plan was generated.`);
  }
}

function collectResult(plan: InitPlan): Omit<InitApplyResult, "projectManifest"> {
  return {
    created: plan.operations
      .filter((operation) => operation.action === "create")
      .map((operation) => operation.path),
    unchanged: plan.operations
      .filter((operation) => operation.action === "unchanged")
      .map((operation) => operation.path),
  };
}

async function applyFreshTree(plan: InitPlan): Promise<void> {
  const staging = resolve(plan.root, `.lervo.init-${randomUUID()}`);
  await mkdir(staging);
  try {
    for (const operation of plan.operations) {
      if (operation.action !== "create" || operation.path === lervoRelativePaths.root) continue;
      const suffix = operation.path.slice(`${lervoRelativePaths.root}/`.length);
      const target = resolve(staging, suffix);
      if (operation.kind === "directory") await mkdir(target);
      else await writeFile(target, operation.content, { encoding: "utf8", flag: "wx" });
    }
    await rename(staging, resolveManagedPath(plan.root, lervoRelativePaths.root));
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function applyIncrementallyWithRollback(plan: InitPlan): Promise<void> {
  const created: InitOperation[] = [];
  try {
    for (const operation of plan.operations) {
      if (operation.action !== "create") continue;
      const path = resolveManagedPath(plan.root, operation.path);
      if (operation.kind === "directory") await mkdir(path);
      else await writeFile(path, operation.content, { encoding: "utf8", flag: "wx" });
      created.push(operation);
    }
  } catch (error) {
    for (const operation of created.reverse()) {
      const path = resolveManagedPath(plan.root, operation.path);
      if (operation.kind === "directory") await rmdir(path).catch(() => undefined);
      else await unlink(path).catch(() => undefined);
    }
    throw error;
  }
}

export async function applyInitPlan(plan: InitPlan): Promise<InitApplyResult> {
  if (plan.schemaVersion !== 1) {
    throw new LervoProjectError("contract_invalid", "The initialization plan version is unsupported.");
  }
  if (plan.status === "blocked" || plan.projectManifest === null) {
    const conflicts = plan.operations
      .filter(
        (operation): operation is Extract<InitOperation, { action: "conflict" }> =>
          operation.action === "conflict",
      )
      .map((operation) => operation.reason);
    throw new LervoProjectError(
      "init_conflict",
      conflicts.length > 0 ? conflicts.join("\n") : "The initialization plan cannot be applied.",
    );
  }

  for (const operation of plan.operations) await preflightOperation(plan.root, operation);

  const rootOperation = plan.operations.find((operation) => operation.path === lervoRelativePaths.root);
  if (rootOperation?.action === "create") await applyFreshTree(plan);
  else await applyIncrementallyWithRollback(plan);

  return { projectManifest: plan.projectManifest, ...collectResult(plan) };
}
