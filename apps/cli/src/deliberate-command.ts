import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type {
  ManagedDeliberationOutcome,
} from "./managed-deliberation.js";
import type { RunProvider } from "./managed-run.js";
import type { CliIo, CliServices } from "./types.js";

export const deliberateUsage =
  "  lervo deliberate --proposer <codex|claude> --reviewer <codex|claude> --verification <suite-id> [--verification <suite-id> ...] [--root <path>] [--json] <topic>\n" +
  "  lervo deliberate --policy <deliberation-policy-id> [--root <path>] [--json] <topic>";

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
    ? code
    : "deliberation_failed";
}

function reason(outcome: ManagedDeliberationOutcome): string {
  if (outcome.outcome.status !== "no_consensus") return "";
  return outcome.outcome.noConsensusReason === "blocking_objections_unresolved"
    ? "차단 반론이 마지막 회차까지 남았습니다."
    : "필수 프로젝트 검증이 모두 통과하지 못했습니다.";
}

export function formatDeliberationOutcome(outcome: ManagedDeliberationOutcome): string {
  const lines = outcome.status === "converged"
    ? [
      "숙의가 결론에 도달했습니다.",
      ...outcome.participants.map((participant) =>
        `- ${participant.name}: ${participant.provider}`),
      `- 기록한 산출물: ${outcome.artifactCount}개`,
      "",
      "최종 결정:",
      outcome.finalContent,
    ]
    : [
      "숙의가 합의에 도달하지 못했습니다.",
      `- 이유: ${reason(outcome)}`,
      `- 기록한 산출물: ${outcome.artifactCount}개`,
      "- 미합의 결과를 결정이나 검증된 지식으로 처리하지 않았습니다.",
      "",
      "마지막 검토:",
      outcome.finalContent,
    ];
  return `${lines.join("\n")}\n`;
}

export async function runDeliberateCommand(
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
        proposer: { type: "string" },
        reviewer: { type: "string" },
        verification: { type: "string", multiple: true },
        policy: { type: "string" },
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
  const topic = parsed.positionals.join(" ").trim();
  const storedPolicyMode = policyId !== undefined;
  const inlineMode =
    (proposer !== "codex" && proposer !== "claude") ||
    (reviewer !== "codex" && reviewer !== "claude") ||
    proposer === reviewer || verificationSuiteIds.length === 0;
  if (topic.length === 0 || (storedPolicyMode
    ? proposer !== undefined || reviewer !== undefined || verificationSuiteIds.length > 0
    : inlineMode)) {
    io.stderr(
      `저장된 policy 하나 또는 서로 다른 proposer·reviewer와 verification suite, 숙의 주제가 필요합니다.\n${deliberateUsage}\n`,
    );
    return 1;
  }
  try {
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    const outcome = await services.executeManagedDeliberation(storedPolicyMode
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
      message: error instanceof Error ? error.message : "숙의를 실행하지 못했습니다.",
    };
    io.stderr(parsed.values.json
      ? `${JSON.stringify(failure)}\n`
      : `숙의를 실행하지 못했습니다. (${failure.code}) ${failure.message}\n`);
    return 1;
  }
}
