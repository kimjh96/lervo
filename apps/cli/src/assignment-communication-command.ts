import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { AssignmentMentionTarget, WorkforceArtifactReference } from "@lervo/agent-workforce";

import { routeAssignmentMention } from "./assignment-mention-routing.js";
import type { CliIo } from "./types.js";

export const assignmentCommunicationUsage =
  "  lervo assignment mention --assignment <id> --from-agent <id> --mention <@agent:id|@role:id|@manager|@reviewer|@verifier> --lease <id> --request-digest <sha256> [--artifact <id>=<sha256>] [--evidence-event <id>] [--apply <plan-id> --write] [--root <path>] [--json]";

function mentionTarget(value: string | undefined): AssignmentMentionTarget {
  if (value === "@manager") return { kind: "manager" };
  if (value === "@reviewer") return { kind: "reviewer" };
  if (value === "@verifier") return { kind: "verifier" };
  const agent = /^@agent:(agt_[a-f0-9]{24})$/u.exec(value ?? "");
  if (agent !== null) return { kind: "agent", agentId: agent[1]! };
  const role = /^@role:([a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)$/u.exec(value ?? "");
  if (role !== null) return { kind: "role", roleId: role[1]! };
  throw new Error("The assignment mention target is invalid or requires another workflow.");
}

function artifacts(values: string[] | undefined): WorkforceArtifactReference[] {
  return (values ?? []).map((value) => {
    const match = /^(art_[A-Za-z0-9_-]{8,128})=(sha256:[a-f0-9]{64})$/u.exec(value);
    if (match === null) throw new Error("--artifact must use <artifact-id>=<sha256>.");
    return { artifactId: match[1]!, contentHash: match[2]! };
  });
}

export async function runAssignmentCommunicationCommand(
  args: string[],
  io: CliIo,
): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        assignment: { type: "string" },
        "from-agent": { type: "string" },
        mention: { type: "string" },
        lease: { type: "string" },
        "request-digest": { type: "string" },
        artifact: { type: "string", multiple: true },
        "evidence-event": { type: "string", multiple: true },
        apply: { type: "string" },
        write: { type: "boolean" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${assignmentCommunicationUsage}\n`);
      return 0;
    }
    if (
      parsed.positionals.length !== 1 ||
      parsed.positionals[0] !== "mention" ||
      parsed.values.assignment === undefined ||
      parsed.values["from-agent"] === undefined ||
      parsed.values.lease === undefined ||
      parsed.values["request-digest"] === undefined ||
      (parsed.values.apply === undefined) !== !(parsed.values.write ?? false)
    ) {
      throw new Error(
        "Assignment mention requires exact assignment, source, target, lease, request, and paired apply/write coordinates.",
      );
    }
    const result = await routeAssignmentMention({
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      assignmentId: parsed.values.assignment,
      fromAgentId: parsed.values["from-agent"],
      leaseId: parsed.values.lease,
      target: mentionTarget(parsed.values.mention),
      requestDigest: parsed.values["request-digest"],
      artifactReferences: artifacts(parsed.values.artifact),
      contextEvidenceEventIds: parsed.values["evidence-event"] ?? [],
      ...(parsed.values.apply === undefined ? {} : { applyPlanId: parsed.values.apply }),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : result.appliedHandoffId === null
          ? `Assignment mention route ${result.plan.status}: ${result.plan.planId}${result.plan.blockedReason === null ? ` -> ${result.plan.recipientAgentId}` : ` (${result.plan.blockedReason})`}\n`
          : `Assignment mention route ${result.plan.planId} recorded handoff ${result.appliedHandoffId}.\n`,
    );
    return result.plan.status === "ready" ? 0 : 1;
  } catch (error) {
    io.stderr(
      `Assignment communication failed: ${error instanceof Error ? error.message : String(error)}\n${assignmentCommunicationUsage}\n`,
    );
    return 1;
  }
}
