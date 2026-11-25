import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  listDurableInstructionCandidates,
  loadDurableInstructionCandidate,
} from "@lervo/repository-knowledge";

import {
  intakeDurableInstruction,
  type DurableInstructionIntakeResult,
} from "./durable-instruction-intake.js";
import { retireDurableInstruction } from "./durable-instruction-retire.js";
import type { CliIo, CliServices } from "./types.js";
import { resolveCommandRoots } from "./terminal-roots.js";

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
    `rule: ${candidate.ruleId}`,
    `source: ${candidate.captureSource ?? "explicit_intake"}`,
    `target: ${candidate.targetPath}`,
    `proposed content hash: ${candidate.proposedContentHash}`,
    "",
    candidate.proposedMarkdown,
  ].join("\n");
}

function formatIntake(result: DurableInstructionIntakeResult): string {
  const reasons = `reasons: ${result.reasonIds.join(", ") || "none"}`;
  if (result.status === "applied" || result.status === "current" || result.status === "stored") {
    const replaced =
      result.replacedPaths.length === 0 ? "" : `replaced: ${result.replacedPaths.join(", ")}\n`;
    const commit = result.commitHash === null ? "" : `commit: ${result.commitHash}\n`;
    const state =
      result.status === "stored"
        ? "Stored the owner rule; the knowledge resident applies it on the convergence owner."
        : `Stored the owner rule (${result.status}).`;
    return `${state}\nrule: ${result.ruleId}\ntarget: ${result.targetPath}\n${replaced}${commit}fidelity: ${result.fidelity}\n${reasons}\nUndo with lervo knowledge instruction retire ${result.ruleId}.\n`;
  }
  if (result.status === "queued")
    return `The owner rule waits in the private capture queue; the knowledge resident retries it until it is stored.\ncapture: ${result.captureId}\n${reasons}\n`;
  return `Durable instruction intake: ${result.status}\n${reasons}\nNo repository instruction was stored.\n`;
}

export async function runKnowledgeDurableInstruction(
  args: string[],
  io: CliIo,
  services?: Pick<CliServices, "groundProductionRequest" | "crossCheckDurableInstruction">,
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
    // An owner rule is repository-wide: from a linked worktree it goes to the registered repository.
    const repositoryRoot = (await resolveCommandRoots(resolve(io.cwd, parsed.values.root ?? ".")))
      .evidenceRoot;
    const result = await intakeDurableInstruction({
      repositoryRoot,
      provider: parsed.values.provider,
      request: await intakeRequest(parsed.values.from, parsed.values.stdin === true, io),
      now: new Date(),
      services,
    });
    io.stdout(parsed.values.json ? `${JSON.stringify(result, null, 2)}\n` : formatIntake(result));
    return ["applied", "current", "stored", "queued"].includes(result.status) ? 0 : 1;
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
    // An owner rule is repository-wide: from a linked worktree it goes to the registered repository.
    const repositoryRoot = (await resolveCommandRoots(resolve(io.cwd, parsed.values.root ?? ".")))
      .evidenceRoot;
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
          ? "No stored durable-instruction candidates wait to be applied.\n"
          : `${candidates.map(formatCandidate).join("\n\n")}\n`,
    );
    return 0;
  }
  if (subcommand === "retire") {
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: { root: { type: "string" }, json: { type: "boolean" } },
    });
    if (parsed.positionals.length !== 1)
      throw new Error("Instruction retire requires one rule ID.");
    const result = await retireDurableInstruction({
      repositoryRoot: (await resolveCommandRoots(resolve(io.cwd, parsed.values.root ?? ".")))
        .evidenceRoot,
      ruleId: parsed.positionals[0]!,
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Retired owner rule ${result.ruleId}.\npath: ${result.path}\n${result.commitHash === null ? "Commit the deletion with the current change.\n" : `commit: ${result.commitHash}\n`}`,
    );
    return 0;
  }
  throw new Error("The instruction command supports intake, status, retire, capture, and bridge.");
}
