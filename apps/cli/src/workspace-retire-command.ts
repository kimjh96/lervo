// `lervo workspace retire`: retires a hosted workspace from the terminal, as the ADE's
// `workspace.retire` command does (Lervo ADE sessions, "Retiring a workspace").
import { parseArgs } from "node:util";

import { retireHostedWorkspace } from "./hosted-workspace-retire.js";
import { hostedWorkspaceRetireEffects } from "./hosted-workspace-retire-effects.js";
import type { CliIo } from "./types.js";

export const workspaceRetireUsage = `  lervo workspace retire --workspace <workspace-id> [--discard-changes] [--json]`;

export async function runWorkspaceRetireCommand(args: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      workspace: { type: "string" },
      // Removes a worktree that holds changes, after keeping a bounded copy of them.
      "discard-changes": { type: "boolean" },
      json: { type: "boolean" },
    },
  });
  if (values.workspace === undefined) throw new Error("Workspace retirement requires --workspace.");
  const result = await retireHostedWorkspace(values.workspace, hostedWorkspaceRetireEffects(), {
    discardChanges: values["discard-changes"] === true,
  });
  if (values.json) io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  else
    io.stdout(
      `Retired ${result.workspaceId}: worktree ${result.worktree}, branch ${result.branch}${
        result.branch === "kept" ? " (it holds commits the default branch lacks)" : ""
      }${
        result.keptChanges === undefined
          ? ""
          : `; its changes are kept at ${result.keptChanges.ref} for 14 days, and \`${result.keptChanges.restore}\` brings them back`
      }.\n`,
    );
  return 0;
}
