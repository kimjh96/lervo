import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type {
  ManagedDeliberationOutcome,
} from "./managed-deliberation.js";
import type { RunProvider } from "./managed-run.js";
import type { CliIo, CliServices } from "./types.js";
import {
  formatDeliberationInspection,
  inspectManagedDeliberation,
} from "./deliberation-inspection.js";

export const deliberateUsage =
  "  lervo deliberate --proposer <codex|claude> --reviewer <codex|claude> --verification <suite-id> [--verification <suite-id> ...] [--root <path>] [--json] <topic>\n" +
  "  lervo deliberate --policy <deliberation-policy-id> [--root <path>] [--json] <topic>\n" +
  "  lervo deliberate --resume <deliberation-id> [--root <path>] [--json]\n" +
  "  lervo deliberate status <deliberation-id> [--root <path>] [--json]";

async function runDeliberationStatusCommand(
  args: string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (parsed.positionals.length !== 1) throw new Error("Exactly one deliberation ID is required.");
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${deliberateUsage}\n`);
    return 1;
  }
  let storage;
  try {
    storage = await services.openProjectStorage(resolve(io.cwd, parsed.values.root ?? "."));
    const report = await inspectManagedDeliberation({
      storage,
      deliberationId: parsed.positionals[0]!,
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatDeliberationInspection(report));
    return report.sourceStatus === "consistent" ? 0 : 1;
  } catch (error) {
    io.stderr(`Could not inspect deliberation status. (${errorCode(error)}) ${
      error instanceof Error ? error.message : "Unknown error."
    }\n`);
    return 1;
  } finally {
    await storage?.close().catch(() => undefined);
  }
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
    ? code
    : "deliberation_failed";
}

function reason(outcome: ManagedDeliberationOutcome): string {
  if (outcome.outcome.status !== "no_consensus") return "";
  return outcome.outcome.noConsensusReason === "blocking_objections_unresolved"
    ? "Blocking objections remained through the final round."
    : "Not every required repository verification passed.";
}

export function formatDeliberationOutcome(outcome: ManagedDeliberationOutcome): string {
  const lines = outcome.status === "converged"
    ? [
      "Deliberation reached a decision.",
      ...outcome.participants.map((participant) =>
        `- ${participant.name}: ${participant.provider}`),
      `- Recorded artifacts: ${outcome.artifactCount}`,
      "",
      "Final decision:",
      outcome.finalContent,
    ]
    : [
      "Deliberation did not reach consensus.",
      `- Reason: ${reason(outcome)}`,
      `- Recorded artifacts: ${outcome.artifactCount}`,
      "- The no-consensus result was not treated as a decision or verified knowledge.",
      "",
      "Last review:",
      outcome.finalContent,
    ];
  return `${lines.join("\n")}\n`;
}

export async function runDeliberateCommand(
  args: string[],
  io: CliIo,
  services: CliServices,
): Promise<number> {
  if (args[0] === "status") {
    return runDeliberationStatusCommand(args.slice(1), io, services);
  }
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        proposer: { type: "string" },
        reviewer: { type: "string" },
        verification: { type: "string", multiple: true },
        policy: { type: "string" },
        resume: { type: "string" },
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${deliberateUsage}\n`);
    return 1;
  }
  if (parsed.values.help) {
    io.stdout(`${deliberateUsage}\n`);
    return 0;
  }
  const proposer = parsed.values.proposer;
  const reviewer = parsed.values.reviewer;
  const verificationSuiteIds = parsed.values.verification ?? [];
  const policyId = parsed.values.policy;
  const resumeDeliberationId = parsed.values.resume;
  const topic = parsed.positionals.join(" ").trim();
  const storedPolicyMode = policyId !== undefined;
  const resumeMode = resumeDeliberationId !== undefined;
  const inlineMode =
    (proposer !== "codex" && proposer !== "claude") ||
    (reviewer !== "codex" && reviewer !== "claude") ||
    proposer === reviewer || verificationSuiteIds.length === 0;
  const invalidMode = resumeMode
    ? topic.length > 0 || storedPolicyMode || proposer !== undefined || reviewer !== undefined ||
      verificationSuiteIds.length > 0
    : topic.length === 0 || (storedPolicyMode
      ? proposer !== undefined || reviewer !== undefined || verificationSuiteIds.length > 0
      : inlineMode);
  if (invalidMode) {
    io.stderr(
      `Provide one resume ID, a stored policy with a topic, or distinct proposer and reviewer providers with a verification suite and topic.\n${deliberateUsage}\n`,
    );
    return 1;
  }
  try {
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const outcome = await services.executeManagedDeliberation(resumeMode
      ? { repositoryRoot, resumeDeliberationId }
      : storedPolicyMode
        ? { repositoryRoot, policyId, topic }
        : {
        repositoryRoot,
        proposerProvider: proposer as RunProvider,
        reviewerProvider: reviewer as RunProvider,
        verificationSuiteIds,
        topic,
        });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(outcome, null, 2)}\n`
      : formatDeliberationOutcome(outcome));
    return outcome.status === "converged" ? 0 : 2;
  } catch (error) {
    const failure = {
      code: errorCode(error),
      message: error instanceof Error ? error.message : "Could not run deliberation.",
    };
    io.stderr(parsed.values.json
      ? `${JSON.stringify(failure)}\n`
      : `Could not run deliberation. (${failure.code}) ${failure.message}\n`);
    return 1;
  }
}
