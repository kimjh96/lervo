import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { ManagedRunOutcome, RunProvider } from "./managed-run.js";
import type { CliIo, CliServices } from "./types.js";
import { runSupervisedManagedCommand } from "./supervised-run-command.js";

export const runUsage =
  "  lervo run --provider <codex|claude> [--role <built-in-or-repository-role-id>] --path <relative-path> [--path <relative-path> ...] --verification <suite-id> [--verification <suite-id> ...] [--assignment <id> --agent <id> --lease <id>] [--execution-key <sha256>] [--skill <skill-id> ...] [--capability <package-id> ...] [--root <path>] [--risk <level>] [--json] (<request> | --stdin)";

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : "run_failed";
}

export function formatRunOutcome(outcome: ManagedRunOutcome): string {
  const changes = outcome.managedChanges
    .map((change) => `  ${change.changeKind}  ${change.path}`)
    .join("\n");
  const skills =
    outcome.resolvedSkills.length === 0
      ? "  none"
      : outcome.resolvedSkills
          .map((skill) => `  ${skill.skillId}@${skill.version} (${skill.sourceKind})`)
          .join("\n");
  const publication = outcome.writingPublication;
  const capabilities =
    outcome.resolvedCapabilities.length === 0
      ? "  none"
      : outcome.resolvedCapabilities
          .map(
            (item) => `  ${item.capabilityId}@${item.version} (${item.kind}, ${item.sourceKind})`,
          )
          .join("\n");
  const activatedCapabilities =
    outcome.activatedCapabilities.length === 0
      ? "  none"
      : outcome.activatedCapabilities
          .map((item) => `  ${item.capabilityId}@${item.version} (${item.evidence})`)
          .join("\n");
  const lines = [
    `Managed run completed. provider: ${outcome.provider}; role: ${outcome.roleId}`,
    `runId: ${outcome.runId}`,
    "Verified changes:",
    changes,
    "Resolved skills:",
    skills,
    "Verified skill instructions were invoked by Lervo; semantic provider reliance remains unobservable.",
    "Resolved capability packages:",
    capabilities,
    "Resolution alone does not claim loading, injection, activation, or use.",
    "Provider-confirmed capability activations:",
    activatedCapabilities,
    "Activation does not claim that a capability was invoked or used.",
    `Search context: ${outcome.searchContext.attemptId} · recommended ${
      outcome.searchContext.recommendedDocuments
    } · selected ${outcome.searchContext.selectedDocuments}`,
    "Only selected search recommendations may be loaded or injected later.",
    `Documents selected from search: ${outcome.searchContext.selectedDocumentIds.join(", ") || "none"}`,
    `Functional verification: ${
      outcome.verificationStatus === "passed"
        ? "passed"
        : outcome.verificationStatus === "failed"
          ? "failed"
          : "not run"
    }`,
    ...outcome.verifications.map(
      (verification) => `  ${verification.result.suiteId}: ${verification.result.status}`,
    ),
    `Writing publication verification: ${publication.status === "allowed" ? "passed" : "failed"}`,
  ];
  if (publication.status === "allowed") {
    lines.push("", "Provider result:", publication.content);
  } else {
    lines.push("The provider result was not published.");
    if (publication.failedChecks.length > 0) {
      lines.push(`Failed checks: ${publication.failedChecks.join(", ")}`);
    }
    if (publication.missingChecks.length > 0) {
      lines.push(`Incomplete checks: ${publication.missingChecks.join(", ")}`);
    }
  }
  return lines.join("\n").concat("\n");
}

export async function runManagedCommand(
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
        provider: { type: "string" },
        "execution-key": { type: "string" },
        "provider-executable": { type: "string" },
        role: { type: "string" },
        path: { type: "string", multiple: true },
        stdin: { type: "boolean" },
        "supervised-stdin": { type: "boolean" },
        root: { type: "string" },
        risk: { type: "string" },
        skill: { type: "string", multiple: true },
        capability: { type: "string", multiple: true },
        verification: { type: "string", multiple: true },
        assignment: { type: "string" },
        agent: { type: "string" },
        lease: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${runUsage}\n`);
    return 1;
  }
  if (parsed.values.help) {
    io.stdout(`${runUsage}\n`);
    return 0;
  }

  const provider = parsed.values.provider;
  if (parsed.values["supervised-stdin"]) {
    if (
      parsed.positionals.length !== 0 ||
      Object.keys(parsed.values).some((key) => !["supervised-stdin", "root", "json"].includes(key))
    ) {
      io.stderr("A supervised invocation accepts only --root and --json.\n");
      return 1;
    }
    return runSupervisedManagedCommand(resolve(io.cwd, parsed.values.root ?? "."), io, services);
  }
  const expectedPaths = parsed.values.path ?? [];
  let instructions = parsed.positionals.join(" ").trim();
  if (parsed.values.stdin) {
    if (parsed.positionals.length > 0 || io.stdin === undefined) {
      io.stderr("--stdin requires available standard input and no positional request.\n");
      return 1;
    }
    try {
      const input = await io.stdin(131072);
      if (Buffer.byteLength(input, "utf8") > 131072)
        throw new Error("The managed task request is too large.");
      instructions = input.trim();
    } catch {
      io.stderr("Could not read the managed task request from standard input.\n");
      return 1;
    }
  }
  const verificationSuiteIds = parsed.values.verification ?? [];
  const workforceCoordinates = [parsed.values.assignment, parsed.values.agent, parsed.values.lease];
  const roleId = parsed.values.role ?? "developer";
  if (
    (provider !== "codex" && provider !== "claude") ||
    expectedPaths.length === 0 ||
    verificationSuiteIds.length === 0 ||
    instructions.length === 0 ||
    Buffer.byteLength(instructions, "utf8") > 131072 ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(roleId) ||
    roleId.length > 100 ||
    (workforceCoordinates.some((value) => value !== undefined) &&
      workforceCoordinates.some((value) => value === undefined))
  ) {
    io.stderr(
      `A provider, path, verification suite, and task request are required.\n${runUsage}\n`,
    );
    return 1;
  }

  try {
    const outcome = await services.executeManagedRun({
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      provider: provider as RunProvider,
      ...(expectedPaths.length === 1 ? { expectedPath: expectedPaths[0]! } : { expectedPaths }),
      instructions,
      ...(parsed.values["execution-key"] === undefined
        ? {}
        : { executionKey: parsed.values["execution-key"] }),
      ...(parsed.values["provider-executable"] === undefined
        ? {}
        : { providerExecutable: parsed.values["provider-executable"] }),
      risk: parsed.values.risk ?? "medium",
      skillIds: parsed.values.skill ?? [],
      capabilityIds: parsed.values.capability ?? [],
      verificationSuiteIds,
      roleId,
      ...(parsed.values.assignment === undefined
        ? {}
        : {
            workforce: {
              assignmentId: parsed.values.assignment,
              agentId: parsed.values.agent!,
              leaseId: parsed.values.lease!,
            },
          }),
    });
    io.stdout(
      parsed.values.json ? `${JSON.stringify(outcome, null, 2)}\n` : formatRunOutcome(outcome),
    );
    return outcome.writingPublication.status === "allowed" &&
      outcome.verificationStatus === "passed"
      ? 0
      : 1;
  } catch (error) {
    const failure = {
      code: errorCode(error),
      message: error instanceof Error ? error.message : "The managed run failed.",
    };
    io.stderr(
      parsed.values.json
        ? `${JSON.stringify(failure)}\n`
        : `Could not complete the managed run. (${failure.code}) ${failure.message}\n`,
    );
    return 1;
  }
}
