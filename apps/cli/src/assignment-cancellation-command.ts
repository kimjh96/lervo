import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  cancelAssignment,
  createAssignmentCancellationPlan,
  listAssignments,
  type AssignmentCancellationStep,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import type { CliIo } from "./types.js";
import { recordWorkforceEvent } from "./workforce-events.js";

export const assignmentCancellationUsage =
  "  lervo assignment cancel --assignment <id> [--reason <requested|dependency_cancelled>] [--apply <plan-id> --write] [--root <path>] [--json]";

export async function runAssignmentCancellationCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        assignment: { type: "string" },
        reason: { type: "string" },
        apply: { type: "string" },
        write: { type: "boolean" },
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${assignmentCancellationUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "cancel") {
      throw new Error("The assignment cancellation action is invalid.");
    }
    if (parsed.values.assignment === undefined) {
      throw new Error("Assignment cancellation requires an assignment ID.");
    }
    const reason = parsed.values.reason ?? "requested";
    if (reason !== "requested" && reason !== "dependency_cancelled") {
      throw new Error("Assignment cancellation reason is invalid.");
    }
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const plan = createAssignmentCancellationPlan({
      assignments: await listAssignments(repositoryRoot),
      assignmentId: parsed.values.assignment,
      reason,
    });
    if (parsed.values.apply === undefined) {
      if (parsed.values.write) {
        throw new Error("Cancellation planning is read-only; apply requires the exact plan ID.");
      }
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(plan, null, 2)}\n`
          : `Assignment cancellation ${plan.status}: ${plan.planId}${plan.blockedReason === null ? "" : ` · ${plan.blockedReason}`}${plan.status === "ready" ? `\nRe-run with --apply ${plan.planId} --write.` : ""}\n`,
      );
      return plan.status === "blocked" ? 1 : 0;
    }
    if (!parsed.values.write || parsed.values.apply !== plan.planId) {
      throw new Error(
        "Assignment cancellation apply requires --write and the exact current plan ID.",
      );
    }
    const storage = await openProjectStorage(repositoryRoot);
    try {
      const assignment = await cancelAssignment({
        repositoryRoot,
        assignmentId: parsed.values.assignment,
        reason: reason as AssignmentCancellationStep["reason"],
        expectedPlanId: parsed.values.apply,
        recordEvent: (event) => recordWorkforceEvent(storage, event),
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(assignment, null, 2)}\n`
          : `Assignment ${assignment.assignmentId} cancelled at revision ${assignment.revision}.\n`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "assignment_cancellation_failed";
    io.stderr(
      `Assignment cancellation failed (${code}): ${error instanceof Error ? error.message : String(error)}\n${assignmentCancellationUsage}\n`,
    );
    return 1;
  }
}
