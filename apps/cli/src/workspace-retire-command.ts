// `lervo workspace retire`: retires a hosted workspace from the terminal, as the ADE's
// `workspace.retire` command does (Lervo ADE sessions, "Retiring a workspace").
import { parseArgs } from "node:util";

import { retireHostedWorkspace } from "./hosted-workspace-retire.js";
import { hostedWorkspaceRetireEffects } from "./hosted-workspace-retire-effects.js";
import type { CliIo } from "./types.js";

export const workspaceRetireUsage = `  lervo workspace retire --workspace <workspace-id> [--json]`;

export async function runWorkspaceRetireCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { workspace: { type: "string" }, json: { type: "boolean" } },
  });
  if (values.workspace === undefined) throw new Error("Workspace retirement requires --workspace.");
  const result = await retireHostedWorkspace(values.workspace, hostedWorkspaceRetireEffects());
  if (values.json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  else
    io.stdout(
      `Retired ${result.workspaceId}: worktree ${result.worktree}, branch ${result.branch}${
        result.branch === "kept" ? " (it holds commits the default branch lacks)" : ""
      }.\n`,
    );
  return 0;
}
