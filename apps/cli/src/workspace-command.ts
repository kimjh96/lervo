import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  isConversationWorkspace,
  listWorkspaces,
  newestCheckoutWorkspace,
  observeWorkspaceWriterLiveness,
  readWorkspace,
  readWorkspaceCleanupJournal,
} from "@lervo/agent-workforce";
import {
  applyWorkspaceCleanup,
  planWorkspaceCleanup,
  recoverWorkspaceCleanup,
  type WorkspaceCleanupPlan,
} from "@lervo/orchestrator";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import type { WorkspaceCleanupHostAdapter } from "@lervo/workspace-host";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import { OrcaWorkspaceHostAdapter } from "@lervo/workspace-host-orca";

import { checkoutPathDigests } from "./checkout-path-digests.js";
import type { CliIo } from "./types.js";
import { retireRepositoryUnstartedWorkspaces } from "./workspace-retirement.js";
import { runWorkspaceLaunchCommand, workspaceStartUsage } from "./workspace-start-command.js";
import { runWorkspaceHookCommand, workspaceHookUsage } from "./workspace-hook-command.js";
import { runWorkspaceRetireCommand, workspaceRetireUsage } from "./workspace-retire-command.js";

export const workspaceUsage = `${workspaceStartUsage}
${workspaceHookUsage}
${workspaceRetireUsage}
  lervo workspace inspect [--root <path>] [--json]
  lervo workspace cleanup --workspace <workspace-id> --workspace-path <path> --target-ref <ref> [--root <path>] [--stdin --apply <plan-id>] [--json]
  lervo workspace recover --journal <journal-id> --workspace-path <path> --target-ref <ref> [--root <path>] [--json]
  lervo workspace retire-unstarted --supervision <id> --workstream <id> [--workspace <workspace-id>] --write [--root <path>] [--json]`;

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

async function runRetireUnstarted(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      supervision: { type: "string" },
      workstream: { type: "string" },
      workspace: { type: "string" },
      write: { type: "boolean" },
      root: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (!values.write || values.supervision === undefined || values.workstream === undefined)
    throw new Error("Workspace retirement requires --supervision, --workstream and --write.");
  const result = await retireRepositoryUnstartedWorkspaces({
    root: await repositoryRootFrom(resolve(io.cwd, values.root ?? ".")),
    supervisionId: values.supervision,
    workstreamId: values.workstream,
    ...(values.workspace === undefined ? {} : { workspaceId: values.workspace }),
  });
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  return result.results.some((item) => item.status === "refused") ? 1 : 0;
}

async function runInspect(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: { root: { type: "string" }, json: { type: "boolean" } },
  });
  if (parsed.positionals.length !== 0)
    throw new Error("The workspace inspect arguments are invalid.");
  const root = await repositoryRootFrom(resolve(io.cwd, parsed.values.root ?? "."));
  const pathDigest = repositoryCoordinateDigest(root);
  const all = await listWorkspaces(root);
  const live = all.filter(
    (workspace) => workspace.pathDigest === pathDigest && workspace.state !== "removed",
  );
  // A conversation's checkout speaks through its newest generation; an earlier one that waits
  // for integration is not a second writer. A worker's checkout lists every live record, so a
  // shared checkout still shows.
  const newest = newestCheckoutWorkspace(all, await checkoutPathDigests(root));
  const workspaces = newest !== null && isConversationWorkspace(newest) ? [newest] : live;
  const observedAt = new Date();
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
        return {
          workspace,
          markerHashMatched,
          hostInspection: null,
          writerLiveness: observeWorkspaceWriterLiveness({ workspace, observedAt }),
        };
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
      return {
        workspace,
        markerHashMatched,
        hostInspection,
        writerLiveness: observeWorkspaceWriterLiveness({ workspace, observedAt }),
      };
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
  const report = {
    schemaVersion: 1,
    status,
    repositoryRoot: root,
    pathDigest,
    observedAt: observedAt.toISOString(),
    inspections,
    limitations: [
      "A stale writer observation does not prove provider termination and never releases writer or assignment authority.",
    ],
  };
  if (parsed.values.json) io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  else
    io.stdout(
      status === "unmanaged"
        ? "The current checkout is not a Lervo-managed workspace.\n"
        : `Workspace inspection: ${status}; matches=${inspections.length}\n`,
    );
  return status === "action_required" ? 1 : 0;
}

function cleanupHost(kind: "git" | "orca"): WorkspaceCleanupHostAdapter {
  return kind === "git" ? new GitWorkspaceHostAdapter() : new OrcaWorkspaceHostAdapter();
}

async function cleanupCoordinates(
  values: {
    root: string | undefined;
    workspacePath: string | undefined;
    targetRef: string | undefined;
  },
  io: CliIo,
) {
  if (values.workspacePath === undefined || values.targetRef === undefined)
    throw new Error("--workspace-path and --target-ref are required.");
  return {
    repositoryRoot: await repositoryRootFrom(resolve(io.cwd, values.root ?? ".")),
    workspacePath: resolve(io.cwd, values.workspacePath),
    integrationTargetRef: values.targetRef,
  };
}

function cleanupOutput(value: unknown, json: boolean | undefined, io: CliIo): void {
  io.stdout(
    json
      ? `${JSON.stringify(value, null, 2)}\n`
      : `${(value as { status: string }).status}: ${(value as { planId?: string; workspaceId?: string }).planId ?? (value as { workspaceId?: string }).workspaceId ?? "workspace"}\n`,
  );
}

async function runCleanup(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      workspace: { type: "string" },
      "workspace-path": { type: "string" },
      "target-ref": { type: "string" },
      stdin: { type: "boolean" },
      apply: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (parsed.values.workspace === undefined) throw new Error("--workspace is required.");
  if ((parsed.values.stdin ?? false) !== (parsed.values.apply !== undefined))
    throw new Error("Use --stdin and --apply together, or omit both for a read-only plan.");
  const coordinates = await cleanupCoordinates(
    {
      root: parsed.values.root,
      workspacePath: parsed.values["workspace-path"],
      targetRef: parsed.values["target-ref"],
    },
    io,
  );
  const stored = await readWorkspace(coordinates.repositoryRoot, parsed.values.workspace);
  if (stored === null) throw new Error("The workspace record is absent.");
  const host = cleanupHost(stored.workspace.host.kind);
  if (parsed.values.apply === undefined) {
    const plan = await planWorkspaceCleanup({
      coordinates,
      workspaceId: parsed.values.workspace,
      host,
    });
    cleanupOutput(plan, parsed.values.json, io);
    return plan.status === "ready" ? 0 : 1;
  }
  if (io.stdin === undefined) throw new Error("Cleanup plan stdin is unavailable.");
  const raw = await io.stdin();
  if (Buffer.byteLength(raw) > 256 * 1024) throw new Error("The cleanup plan exceeds 256 KiB.");
  const plan = JSON.parse(raw) as WorkspaceCleanupPlan;
  if (plan.planId !== parsed.values.apply || plan.workspaceId !== parsed.values.workspace)
    throw new Error("The cleanup apply coordinates differ from the supplied plan.");
  const receipt = await applyWorkspaceCleanup({ plan, coordinates, host });
  cleanupOutput(receipt, parsed.values.json, io);
  return 0;
}

async function runRecover(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      journal: { type: "string" },
      "workspace-path": { type: "string" },
      "target-ref": { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (parsed.values.journal === undefined) throw new Error("--journal is required.");
  const coordinates = await cleanupCoordinates(
    {
      root: parsed.values.root,
      workspacePath: parsed.values["workspace-path"],
      targetRef: parsed.values["target-ref"],
    },
    io,
  );
  const journal = await readWorkspaceCleanupJournal(
    coordinates.repositoryRoot,
    parsed.values.journal,
  );
  if (journal === null) throw new Error("The cleanup journal is absent.");
  const result = await recoverWorkspaceCleanup({
    coordinates,
    journalId: parsed.values.journal,
    host: cleanupHost(journal.journal.marker.adapterKind),
  });
  cleanupOutput(
    { schemaVersion: 1, status: result.status, workspaceId: result.workspace.workspaceId },
    parsed.values.json,
    io,
  );
  return result.status === "recovery_required" ? 1 : 0;
}

export async function runWorkspaceCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const [action, ...rest] = args;
    if (action === "start" || action === "open")
      return await runWorkspaceLaunchCommand(action, rest, io);
    if (action === "hook") return await runWorkspaceHookCommand(rest, io);
    if (action === "retire") return await runWorkspaceRetireCommand(rest, io);
    if (action === "inspect") return await runInspect(rest, io);
    if (action === "cleanup") return await runCleanup(rest, io);
    if (action === "recover") return await runRecover(rest, io);
    if (action === "retire-unstarted") return await runRetireUnstarted(rest, io);
    throw new Error("The workspace action is invalid.");
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${workspaceUsage}\n`);
    return 1;
  }
}
