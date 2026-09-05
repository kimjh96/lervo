import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type {
  AssignmentMessageTriggerAdapterV1,
  AssignmentMessageTriggerRequestV1,
} from "@lervo/agent-workforce";

import { reviewedMessageFileTriggerAdapter } from "./assignment-message-trigger-adapter.js";
import { routeAssignmentMessageTrigger } from "./assignment-message-trigger-routing.js";
import type { CliIo } from "./types.js";

export const assignmentMessageTriggerUsage =
  "  lervo assignment trigger --from <request.json> [--apply <plan-id> --write] [--root <path>] [--json]";

async function request(path: string): Promise<AssignmentMessageTriggerRequestV1> {
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > 64 * 1024) {
    throw new Error("The assignment message trigger request exceeds 64 KiB.");
  }
  try {
    return JSON.parse(content) as AssignmentMessageTriggerRequestV1;
  } catch {
    throw new Error("The assignment message trigger request must be valid JSON.");
  }
}

export async function runAssignmentMessageTriggerCommand(
  args: string[],
  io: CliIo,
  adapter: AssignmentMessageTriggerAdapterV1 = reviewedMessageFileTriggerAdapter,
): Promise<number> {
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
      io.stdout(`${assignmentMessageTriggerUsage}\n`);
      return 0;
    }
    if (
      parsed.positionals.length !== 1 ||
      parsed.positionals[0] !== "trigger" ||
      parsed.values.from === undefined ||
      (parsed.values.apply === undefined) !== !(parsed.values.write ?? false)
    ) {
      throw new Error(
        "Assignment message triggering requires a request and paired apply/write fields.",
      );
    }
    const result = await routeAssignmentMessageTrigger({
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      request: await request(resolve(io.cwd, parsed.values.from)),
      adapter,
      ...(parsed.values.apply === undefined ? {} : { applyPlanId: parsed.values.apply }),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : result.handoffId === null
          ? `Assignment message trigger ${result.plan.status}: ${result.plan.planId}.\n`
          : `Assignment message trigger ${result.plan.disposition}: ${result.handoffId}.\n`,
    );
    return result.plan.status === "blocked" ? 1 : 0;
  } catch (error) {
    io.stderr(
      `Assignment message trigger failed: ${error instanceof Error ? error.message : String(error)}\n${assignmentMessageTriggerUsage}\n`,
    );
    return 1;
  }
}
