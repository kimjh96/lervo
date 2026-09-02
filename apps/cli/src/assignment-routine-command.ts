import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { AssignmentRoutineRequestV1 } from "@lervo/application-contract";

import { materializeAssignmentRoutine } from "./assignment-routine-materialization.js";
import type { CliIo } from "./types.js";

export const assignmentRoutineUsage =
  "  lervo routine materialize --from <request.json> [--apply <plan-id> --write] [--root <path>] [--json]";

async function request(path: string): Promise<AssignmentRoutineRequestV1> {
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > 64 * 1024)
    throw new Error("The assignment routine request exceeds 64 KiB.");
  try {
    return JSON.parse(content) as AssignmentRoutineRequestV1;
  } catch {
    throw new Error("The assignment routine request must be valid JSON.");
  }
}

export async function runAssignmentRoutineCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        from: { type: "string" },
        apply: { type: "string" },
        write: { type: "boolean" },
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${assignmentRoutineUsage}\n`);
      return 0;
    }
    if (
      parsed.positionals.length !== 1 ||
      parsed.positionals[0] !== "materialize" ||
      parsed.values.from === undefined ||
      (parsed.values.apply === undefined) !== !(parsed.values.write ?? false)
    )
      throw new Error("Routine materialization requires a request and paired apply/write fields.");
    const result = await materializeAssignmentRoutine({
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      request: await request(resolve(io.cwd, parsed.values.from)),
      ...(parsed.values.apply === undefined ? {} : { applyPlanId: parsed.values.apply }),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : result.receipt === null
          ? `Assignment routine ${result.plan.disposition}: ${result.plan.planId} (${result.plan.steps.length} pending nodes).\n`
          : `Assignment routine ${result.receipt.invocationId} materialized ${result.receipt.createdAssignmentIds.length} assignments.\n`,
    );
    return result.plan.status === "blocked" ? 1 : 0;
  } catch (error) {
    io.stderr(
      `Assignment routine failed: ${error instanceof Error ? error.message : String(error)}\n${assignmentRoutineUsage}\n`,
    );
    return 1;
  }
}
