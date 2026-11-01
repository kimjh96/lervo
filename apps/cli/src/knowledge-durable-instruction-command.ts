import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  listDurableInstructionCandidates,
  loadDurableInstructionCandidate,
} from "@lervo/repository-knowledge";

import { intakeDurableInstruction } from "./durable-instruction-intake.js";
import {
  applyReviewedDurableInstruction,
  rejectDurableInstructionCandidate,
} from "./durable-instruction-review.js";
import type { CliIo, CliServices } from "./types.js";

async function intakeRequest(
  from: string | undefined,
  useStdin: boolean,
  io: CliIo,
): Promise<string> {
  if ((from === undefined) === !useStdin)
    throw new Error("Instruction intake requires exactly one of --from or --stdin.");
  const bytes = useStdin
    ? await (io.stdin?.() ?? Promise.reject(new Error("Standard input is unavailable.")))
    : await readFile(resolve(io.cwd, from!), "utf8");
  if (Buffer.byteLength(bytes) > 32 * 1024)
    throw new Error("The instruction intake request exceeds 32 KiB.");
  const value = JSON.parse(bytes) as { schemaVersion?: unknown; request?: unknown };
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    value.schemaVersion !== 1 ||
    typeof value.request !== "string" ||
    value.request.trim() === "" ||
    Buffer.byteLength(value.request) > 16 * 1024
  )
    throw new Error("Instruction intake expects {schemaVersion:1,request:<non-empty string>}.");
  return value.request;
}

function formatCandidate(candidate: Awaited<ReturnType<typeof loadDurableInstructionCandidate>>) {
  return [
    `candidate: ${candidate.candidateId}`,
    `candidate hash: ${candidate.candidateHash}`,
    `rule: ${candidate.ruleId}`,
    `source: ${candidate.captureSource ?? "explicit_intake"}`,
    `target: ${candidate.targetPath}`,
    `proposed content hash: ${candidate.proposedContentHash}`,
    "",
    candidate.proposedMarkdown,
  ].join("\n");
}

export async function runKnowledgeDurableInstruction(
  args: string[],
  io: CliIo,
  services?: Pick<CliServices, "groundProductionRequest">,
): Promise<number> {
  const subcommand = args[0];
  if (subcommand === "intake") {
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        provider: { type: "string" },
        from: { type: "string" },
        stdin: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
    if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude")
      throw new Error("Instruction intake requires --provider codex or --provider claude.");
    if (services === undefined)
      throw new Error("The durable-instruction grounding service is unavailable.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const result = await intakeDurableInstruction({
      repositoryRoot,
      provider: parsed.values.provider,
      request: await intakeRequest(parsed.values.from, parsed.values.stdin === true, io),
      now: new Date(),
      services,
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : result.candidate === null
          ? `Durable instruction intake: ${result.status}\nplan: ${result.planId}\nreasons: ${result.reasonIds.join(", ") || "none"}\nNo repository instruction or review candidate was created.\n`
          : `Durable instruction review candidate created.\n${formatCandidate(result.candidate)}\nReview the exact Markdown and hash, then use knowledge instruction review with decision apply or reject. Repository instruction bytes have not changed.\n`,
    );
    return result.status === "review_required" || result.status === "current" ? 0 : 1;
  }
  if (subcommand === "status") {
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: { root: { type: "string" }, json: { type: "boolean" } },
    });
    if (parsed.positionals.length > 1)
      throw new Error("Instruction status accepts at most one candidate ID.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const candidates =
      parsed.positionals.length === 1
        ? [
            await loadDurableInstructionCandidate({
              repositoryRoot,
              candidateId: parsed.positionals[0]!,
            }),
          ]
        : await listDurableInstructionCandidates(repositoryRoot);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ schemaVersion: 1, candidates }, null, 2)}\n`
        : candidates.length === 0
          ? "No active durable-instruction review candidates.\n"
          : `${candidates.map(formatCandidate).join("\n\n")}\n`,
    );
    return 0;
  }
  if (subcommand === "review") {
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        decision: { type: "string" },
        reviewer: { type: "string" },
        approval: { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (parsed.positionals.length !== 1)
      throw new Error("Instruction review requires one candidate ID.");
    if (parsed.values.decision !== "apply" && parsed.values.decision !== "reject")
      throw new Error("Instruction review requires --decision apply or --decision reject.");
    if (parsed.values.reviewer === undefined || parsed.values.approval === undefined)
      throw new Error("Instruction review requires --reviewer and --approval.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const common = {
      repositoryRoot,
      candidateId: parsed.positionals[0]!,
      candidateHash: parsed.values.approval,
      reviewerId: parsed.values.reviewer,
    };
    if (parsed.values.decision === "apply") {
      const result = await applyReviewedDurableInstruction({ ...common, now: new Date() });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Applied the reviewed durable repository instruction.\nplan: ${result.planId}\ntarget: ${result.targetPath}\n${result.commitHash === null ? "" : `commit: ${result.commitHash} (published to every host by the convergence owner)\n`}Run the repository knowledge migration and lint lifecycle before completion.\n`,
      );
      return 0;
    }
    const result = await rejectDurableInstructionCandidate(common);
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Rejected and removed durable-instruction candidate ${result.candidateId}.\nreview: ${result.reviewDigest}\n`,
    );
    return 0;
  }
  throw new Error("The instruction command supports intake, status, review, capture, and bridge.");
}
