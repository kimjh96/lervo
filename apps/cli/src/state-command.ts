import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, rename, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { resolveProjectPaths } from "@lervo/project";
import { assertNoKnowledgeMaterializationTransaction } from "@lervo/repository-knowledge";

import type { CliIo } from "./types.js";

export const stateUsage =
  "  lervo state status [--root <path>] [--json]\n  lervo state reset [--apply --approval <plan-id>] [--root <path>] [--json]";

interface StatePlan {
  schemaVersion: 1;
  planKind: "derived_state_reset";
  planId: string;
  repositoryRoot: string;
  status: "ready" | "current";
  fileCount: number;
  totalBytes: number;
  contentDigest: string;
  durableDataPath: ".lervo/data";
  durableDataDisposition: "preserved";
}

interface StateStatus {
  schemaVersion: 1;
  inspectionKind: "derived_state_status";
  repositoryRoot: string;
  stateDisposition: "present" | "empty";
  fileCount: number;
  totalBytes: number;
  durableDataPath: ".lervo/data";
  durableDataDisposition: "preserved";
  resetPlanDisposition: "run_state_reset_to_create_content_bound_plan";
}

function statusFromPlan(current: StatePlan): StateStatus {
  return {
    schemaVersion: 1,
    inspectionKind: "derived_state_status",
    repositoryRoot: current.repositoryRoot,
    stateDisposition: current.status === "ready" ? "present" : "empty",
    fileCount: current.fileCount,
    totalBytes: current.totalBytes,
    durableDataPath: current.durableDataPath,
    durableDataDisposition: current.durableDataDisposition,
    resetPlanDisposition: "run_state_reset_to_create_content_bound_plan",
  };
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function inventory(
  root: string,
  current: string,
  result: Array<{ path: string; bytes: number; hash: string | null }>,
  budget: { bytes: number },
  bindContent: boolean,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink())
      throw new Error("Derived state contains a symbolic link and cannot be reset safely.");
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) await inventory(root, path, result, budget, bindContent);
    else if (entry.isFile()) {
      const stats = await lstat(path);
      budget.bytes += stats.size;
      result.push({
        path: relative(root, path).split(sep).join("/"),
        bytes: stats.size,
        hash: bindContent ? await fileHash(path) : null,
      });
    } else throw new Error("Derived state contains an unsupported filesystem entry.");
    if (result.length > 20_000 || budget.bytes > 2 * 1024 * 1024 * 1024)
      throw new Error("Derived state exceeds the bounded reset inventory.");
  }
}

async function plan(repositoryRoot: string, bindContent: boolean): Promise<StatePlan> {
  const root = resolve(repositoryRoot);
  await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root });
  const state = resolveProjectPaths(root).state;
  const files: Array<{ path: string; bytes: number; hash: string | null }> = [];
  try {
    const stats = await lstat(state);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error("Derived state must be a physical directory.");
    await inventory(state, state, files, { bytes: 0 }, bindContent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const contentDigest = `sha256:${createHash("sha256").update(JSON.stringify(files)).digest("hex")}`;
  return {
    schemaVersion: 1,
    planKind: "derived_state_reset",
    planId: `kstatereset_${contentDigest.slice(7, 31)}`,
    repositoryRoot: root,
    status: files.length === 0 ? "current" : "ready",
    fileCount: files.length,
    totalBytes: files.reduce((total, item) => total + item.bytes, 0),
    contentDigest,
    durableDataPath: ".lervo/data",
    durableDataDisposition: "preserved",
  };
}

export async function runStateCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        apply: { type: "boolean" },
        approval: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${stateUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length !== 1 || !["status", "reset"].includes(parsed.positionals[0]!))
      throw new Error("Specify state status or reset.");
    const action = parsed.positionals[0]!;
    const current = await plan(resolve(io.cwd, parsed.values.root ?? "."), action === "reset");
    if (parsed.positionals[0] === "status") {
      const status = statusFromPlan(current);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(status, null, 2)}\n`
          : `Derived state: ${status.fileCount} files, ${status.totalBytes} bytes (${status.stateDisposition}). Durable .lervo/data is preserved. Run lervo state reset to create a content-bound reset plan.\n`,
      );
      return 0;
    }
    if (!parsed.values.apply) {
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(current, null, 2)}\n`
          : `Derived state: ${current.fileCount} files, ${current.totalBytes} bytes (${current.status}). Durable .lervo/data is preserved.\n${current.status === "ready" ? `Re-run with --apply --approval ${current.planId}.\n` : ""}`,
      );
      return 0;
    }
    if (parsed.values.approval !== current.planId)
      throw new Error("--approval must equal the current state reset plan ID.");
    if (current.status === "ready") {
      const state = resolveProjectPaths(current.repositoryRoot).state;
      const tombstone = resolve(current.repositoryRoot, `.lervo/.state-reset-${current.planId}`);
      await rename(state, tombstone);
      await rm(tombstone, { recursive: true });
    }
    const receipt = {
      ...(await plan(current.repositoryRoot, false)),
      resetPlanId: current.planId,
      removedFiles: current.fileCount,
      removedBytes: current.totalBytes,
    };
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Reset derived state: ${current.fileCount} files, ${current.totalBytes} bytes. Durable .lervo/data was preserved.\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${stateUsage}\n`);
    return 1;
  }
}
