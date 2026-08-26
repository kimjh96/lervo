import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { listWorkspaces } from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";

import type { CliIo } from "./types.js";

export const workspaceUsage = "  lervo workspace inspect [--root <path>] [--json]";

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

async function repositoryRootFrom(start: string): Promise<string> {
  let current = resolve(start);
  while (true) {
    try {
      const manifest = await lstat(resolve(current, ".lervo/project.yaml"));
      if (manifest.isFile() && !manifest.isSymbolicLink()) return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error("No initialized Lervo repository was found.");
    current = parent;
  }
}

export async function runWorkspaceCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: { root: { type: "string" }, json: { type: "boolean" } },
    });
    if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "inspect")
      throw new Error("The workspace action is invalid.");
    const root = await repositoryRootFrom(resolve(io.cwd, parsed.values.root ?? "."));
    const pathDigest = repositoryCoordinateDigest(root);
    const workspaces = (await listWorkspaces(root)).filter(
      (workspace) => workspace.pathDigest === pathDigest && workspace.state !== "removed",
    );
    const inspections = await Promise.all(
      workspaces.map(async (workspace) => {
        const marker = {
          schemaVersion: 1 as const,
          workspaceId: workspace.workspaceId,
          generation: workspace.generation,
          repositoryInstanceId: workspace.repositoryInstanceId,
          adapterKind: workspace.host.kind,
          adapterVersion: workspace.host.version,
          creationPlanId: workspace.creationPlanId,
          pathDigest: workspace.pathDigest,
        };
        const markerHashMatched = digest(marker) === workspace.markerHash;
        if (workspace.host.kind !== "git")
          return { workspace, markerHashMatched, hostInspection: null };
        const host = new GitWorkspaceHostAdapter();
        const hostInspection =
          host.version === workspace.host.version
            ? await host.inspect({
                repositoryRoot: root,
                workspacePath: root,
                baseCommit: workspace.baseCommit,
                marker,
              })
            : null;
        return { workspace, markerHashMatched, hostInspection };
      }),
    );
    const status =
      inspections.length === 0
        ? "unmanaged"
        : inspections.length === 1 &&
            inspections[0]!.markerHashMatched &&
            inspections[0]!.hostInspection?.status === "present"
          ? "current"
          : "action_required";
    const report = { schemaVersion: 1, status, repositoryRoot: root, pathDigest, inspections };
    if (parsed.values.json) io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    else
      io.stdout(
        status === "unmanaged"
          ? "The current checkout is not a Lervo-managed workspace.\n"
          : `Workspace inspection: ${status}; matches=${inspections.length}\n`,
      );
    return status === "action_required" ? 1 : 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${workspaceUsage}\n`);
    return 1;
  }
}
