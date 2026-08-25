import { randomUUID } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyPublicReadmeImprovementPlan,
  createPublicReadmeImprovementPlan,
} from "@lervo/repository-knowledge";

import type { CliIo } from "./types.js";

export const readmeUsage =
  "  lervo readme propose --candidate <path> --audience <text> --intent <text> [--apply <plan-id> --approve-item <operation-id>=<sha256> --approve-coordinate <change-id> ...] [--root <path>] [--json]";

async function candidate(path: string, repositoryRoot: string): Promise<string> {
  const source = await lstat(path);
  let readablePath = path;
  if (source.isSymbolicLink()) {
    const [root, target] = await Promise.all([realpath(repositoryRoot), realpath(path)]);
    const fromRoot = relative(root, target);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`))
      throw new Error("The README candidate symbolic link leaves the repository.");
    readablePath = target;
  } else if (!source.isFile()) throw new Error("The README candidate file is unsafe or too large.");
  const info = await lstat(readablePath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024)
    throw new Error("The README candidate file is unsafe or too large.");
  const handle = await open(readablePath, "r");
  try {
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export async function runReadmeCommand(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        candidate: { type: "string" },
        audience: { type: "string" },
        intent: { type: "string" },
        apply: { type: "string" },
        "approve-item": { type: "string" },
        "approve-coordinate": { type: "string", multiple: true },
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${readmeUsage}\n`);
      return 0;
    }
    if (
      parsed.positionals.length !== 1 ||
      parsed.positionals[0] !== "propose" ||
      parsed.values.candidate === undefined ||
      parsed.values.audience === undefined ||
      parsed.values.intent === undefined
    )
      throw new Error("The public README proposal arguments are incomplete.");
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const content = await candidate(resolve(io.cwd, parsed.values.candidate), root);
    const plan = await createPublicReadmeImprovementPlan({
      repositoryRoot: root,
      candidateContent: content,
      audience: parsed.values.audience,
      intent: parsed.values.intent,
    });
    if (parsed.values.apply === undefined) {
      if (
        parsed.values["approve-item"] !== undefined ||
        (parsed.values["approve-coordinate"]?.length ?? 0) > 0
      )
        throw new Error("Approvals require --apply.");
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify({ ...plan, operations: plan.operations.map(({ content: _content, ...operation }) => operation) }, null, 2)}\n`
          : `Public README improvement: ${plan.status}\nplan: ${plan.planId}\nsource: ${plan.sourceHash ?? "absent"}\ncandidate: ${plan.candidateHash}\nprotected coordinates: ${plan.coordinateCoverage.candidateCount}; changed: ${plan.coordinateCoverage.changedCount}\n${plan.coordinateChanges.map((item) => `  ${item.changeId} · ${item.disposition} ${item.kind} · ${item.value}`).join("\n")}\napproval: ${plan.operationId}=${plan.approvalHash}\nNo README bytes changed.\n`,
      );
      return 0;
    }
    const approval = /^(prdop_[a-f0-9]{24})=(sha256:[a-f0-9]{64})$/u.exec(
      parsed.values["approve-item"] ?? "",
    );
    if (parsed.values.apply !== plan.planId || approval === null)
      throw new Error("The exact current plan and item approval are required.");
    const storage = await openProjectStorage(root);
    try {
      const receipt = await applyPublicReadmeImprovementPlan({
        plan,
        candidateContent: content,
        approvedOperationId: approval[1]!,
        approvedHash: approval[2]!,
        approvedCoordinateChangeIds: parsed.values["approve-coordinate"] ?? [],
        now: new Date(),
        recordApplied: (applied) => {
          const identity = randomUUID().replaceAll("-", "");
          storage.events.append({
            eventId: `evt_${identity}`,
            projectId: storage.manifest.projectId,
            runId: `run_${identity}`,
            sessionId: `ses_${identity}`,
            type: "public_readme.improvement.applied",
            occurredAt: applied.appliedAt,
            actor: { kind: "user" },
            schemaVersion: 1,
            policyVersion: applied.approvalHash,
            payload: {
              operation: applied.operation,
              planId: applied.planId,
              operationId: applied.operationId,
              sourceHash: applied.sourceHash,
              outputHash: applied.outputHash,
              profileId: applied.profileId,
              language: applied.language,
              audienceDigest: applied.audienceDigest,
              intentDigest: applied.intentDigest,
              protectedCoordinateDigest: applied.protectedCoordinateDigest,
              protectedCoordinateCount: applied.protectedCoordinateCount,
              changedCoordinateCount: applied.changedCoordinateCount,
              approvalHash: applied.approvalHash,
              appliedAt: applied.appliedAt,
            },
          });
        },
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(receipt, null, 2)}\n`
          : `Public README improvement applied.\nplan: ${receipt.planId}\noutput: ${receipt.outputHash}\n`,
      );
    } finally {
      await storage.close();
    }
    return 0;
  } catch (error) {
    io.stderr(
      `Public README command failed: ${error instanceof Error ? error.message : String(error)}\n${readmeUsage}\n`,
    );
    return 1;
  }
}
