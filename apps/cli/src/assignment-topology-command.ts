import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { AssignmentTopologyChangeRequestV2 } from "@lervo/application-contract";

import { inspectAssignmentTopology } from "./assignment-topology-inspection.js";
import { materializeAssignmentTopology } from "./assignment-topology-materialization.js";
import type { CliIo } from "./types.js";

export const assignmentTopologyUsage = [
  "  lervo assignment topology inspect [--root <path>] [--json]",
  "  lervo assignment topology change --from <request.json> [--apply <plan-id> --approval <hash> --reviewer <id> --write] [--root <path>] [--json]",
].join("\n");

async function topologyRequest(path: string): Promise<AssignmentTopologyChangeRequestV2> {
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > 128 * 1024)
    throw new Error("The assignment topology request exceeds 128 KiB.");
  try {
    return JSON.parse(content) as AssignmentTopologyChangeRequestV2;
  } catch {
    throw new Error("The assignment topology request must be valid JSON.");
  }
}

export async function runAssignmentTopologyCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        from: { type: "string" },
        apply: { type: "string" },
        approval: { type: "string" },
        reviewer: { type: "string" },
        write: { type: "boolean" },
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${assignmentTopologyUsage}\n`);
      return 0;
    }
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    if (parsed.positionals.length === 1 && parsed.positionals[0] === "inspect") {
      if (
        parsed.values.from !== undefined ||
        parsed.values.apply !== undefined ||
        parsed.values.approval !== undefined ||
        parsed.values.reviewer !== undefined ||
        parsed.values.write
      ) {
        throw new Error("Topology inspection is read-only.");
      }
      const graph = await inspectAssignmentTopology(repositoryRoot);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(graph, null, 2)}\n`
          : `Assignment graph v2 ${graph.graphHash}: ${graph.nodes.length} nodes, ${graph.branchAssignmentIds.length} branches, ${graph.joinAssignmentIds.length} joins.\n`,
      );
      return graph.validity.status === "valid" ? 0 : 1;
    }
    const applying = parsed.values.apply !== undefined;
    if (
      parsed.positionals.length !== 1 ||
      parsed.positionals[0] !== "change" ||
      parsed.values.from === undefined ||
      applying !== (parsed.values.write ?? false) ||
      applying !== (parsed.values.approval !== undefined) ||
      applying !== (parsed.values.reviewer !== undefined)
    ) {
      throw new Error("Topology change requires a request and paired apply authority fields.");
    }
    const result = await materializeAssignmentTopology({
      repositoryRoot,
      request: await topologyRequest(resolve(io.cwd, parsed.values.from)),
      ...(parsed.values.apply === undefined
        ? {}
        : {
            applyPlanId: parsed.values.apply,
            approvalHash: parsed.values.approval!,
            reviewerId: parsed.values.reviewer!,
          }),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : result.receipt === null
          ? `Topology ${result.plan.disposition}: ${result.plan.planId}; approve ${result.plan.approvalHash}.\n`
          : `Topology ${result.receipt.changeId} activated ${result.receipt.createdAssignmentIds.length} new assignments.\n`,
    );
    return result.plan.status === "blocked" ? 1 : 0;
  } catch (error) {
    io.stderr(
      `Assignment topology failed: ${error instanceof Error ? error.message : String(error)}\n${assignmentTopologyUsage}\n`,
    );
    return 1;
  }
}
