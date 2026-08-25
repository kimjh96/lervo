import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { ManagedRunOutcome, RunProvider } from "./managed-run.js";
import type { CliIo, CliServices } from "./types.js";

export const runUsage =
  "  lervo run --provider <codex|claude> [--role <built-in-or-repository-role-id>] --path <relative-path> --verification <suite-id> [--verification <suite-id> ...] [--assignment <id> --agent <id> --lease <id>] [--skill <skill-id> ...] [--capability <package-id> ...] [--root <path>] [--risk <level>] [--json] <request>";

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
  const acceptedAssessment =
    outcome.searchContext.selectedDocumentIds.length === 0
      ? null
      : `lervo search assess ${outcome.searchContext.attemptId} --outcome accepted ${outcome.searchContext.selectedDocumentIds
          .map((id) => `--selected document:${id}`)
          .join(" ")}`;
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
    acceptedAssessment === null
      ? `After reviewing the search results, record an assessment with: lervo search assess ${outcome.searchContext.attemptId} --outcome failed --reason <reason>`
      : `To record acceptance: ${acceptedAssessment}`,
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
        role: { type: "string" },
        path: { type: "string" },
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
  const expectedPath = parsed.values.path;
  const instructions = parsed.positionals.join(" ").trim();
  const verificationSuiteIds = parsed.values.verification ?? [];
  const workforceCoordinates = [parsed.values.assignment, parsed.values.agent, parsed.values.lease];
  const roleId = parsed.values.role ?? "developer";
  if (
    (provider !== "codex" && provider !== "claude") ||
    expectedPath === undefined ||
    verificationSuiteIds.length === 0 ||
    instructions.length === 0 ||
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
      expectedPath,
      instructions,
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
