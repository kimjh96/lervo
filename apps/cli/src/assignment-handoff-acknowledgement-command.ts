import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { acknowledgeAssignmentHandoff } from "@lervo/agent-workforce";

import type { CliIo } from "./types.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

export const assignmentHandoffAcknowledgementUsage =
  "  lervo assignment acknowledge --assignment <id> --handoff <id> --agent <recipient-id> --write [--root <path>] [--json]";

export async function runAssignmentHandoffAcknowledgementCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        assignment: { type: "string" },
        handoff: { type: "string" },
        agent: { type: "string" },
        write: { type: "boolean" },
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${assignmentHandoffAcknowledgementUsage}\n`);
      return 0;
    }
    if (
      parsed.positionals.length !== 1 ||
      parsed.positionals[0] !== "acknowledge" ||
      parsed.values.assignment === undefined ||
      parsed.values.handoff === undefined ||
      parsed.values.agent === undefined ||
      !parsed.values.write
    ) {
      throw new Error(
        "Handoff acknowledgement requires the exact assignment, handoff, recipient, and --write.",
      );
    }
    const assignment = await mutateWorkforceState(
      resolve(io.cwd, parsed.values.root ?? "."),
      (recordEvent) =>
        acknowledgeAssignmentHandoff({
          repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
          assignmentId: parsed.values.assignment!,
          handoffId: parsed.values.handoff!,
          recipientAgentId: parsed.values.agent!,
          recordEvent,
        }),
    );
    const handoff = assignment.handoffs.find((item) => item.handoffId === parsed.values.handoff)!;
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ schemaVersion: 1, assignment, handoff }, null, 2)}\n`
        : `Assignment handoff ${handoff.handoffId} acknowledged by ${handoff.toAgentId}.\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Assignment handoff acknowledgement failed: ${error instanceof Error ? error.message : String(error)}\n${assignmentHandoffAcknowledgementUsage}\n`,
    );
    return 1;
  }
}
