import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { AssignmentConnectorRequestV1 } from "@lervo/application-contract";

import { routeAssignmentConnector } from "./assignment-connector-routing.js";
import type { CliIo, CliServices } from "./types.js";

export const assignmentConnectorUsage =
  "  lervo assignment connector --from <request.json> [--apply <plan-id> --write] [--root <path>] [--json]";

async function readRequest(path: string): Promise<AssignmentConnectorRequestV1> {
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > 64 * 1024)
    throw new Error("The assignment connector request exceeds 64 KiB.");
  try {
    return JSON.parse(content) as AssignmentConnectorRequestV1;
  } catch {
    throw new Error("The assignment connector request must be valid JSON.");
  }
}

export async function runAssignmentConnectorCommand(
  args: string[],
  io: CliIo,
  services: CliServices,
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
      io.stdout(`${assignmentConnectorUsage}\n`);
      return 0;
    }
    if (
      parsed.positionals.length !== 1 ||
      parsed.positionals[0] !== "connector" ||
      parsed.values.from === undefined ||
      (parsed.values.apply === undefined) !== !(parsed.values.write ?? false)
    )
      throw new Error(
        "Assignment connector routing requires a request and paired apply/write fields.",
      );
    const result = await routeAssignmentConnector({
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      request: await readRequest(resolve(io.cwd, parsed.values.from)),
      ...(parsed.values.apply === undefined ? {} : { applyPlanId: parsed.values.apply }),
      ...(services.assignmentConnectorPort === undefined
        ? {}
        : { connector: services.assignmentConnectorPort }),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : result.delivery === null
          ? `Assignment connector route ${result.plan.status}: ${result.plan.planId}.\n`
          : `Assignment connector route ${result.plan.planId}: ${result.delivery.status}.\n`,
    );
    return result.plan.status === "blocked" ||
      (result.delivery !== null && result.delivery.status !== "delivered")
      ? 1
      : 0;
  } catch (error) {
    io.stderr(
      `Assignment connector failed: ${error instanceof Error ? error.message : String(error)}\n${assignmentConnectorUsage}\n`,
    );
    return 1;
  }
}
