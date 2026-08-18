import { resolve } from "node:path";
import { parseArgs } from "node:util";

import type { ManagedRunOutcome, RunProvider } from "./managed-run.js";
import type { CliIo, CliServices } from "./types.js";

export const runUsage =
  "  roven run --provider <codex|claude> --path <relative-path> [--root <path>] [--risk <level>] [--json] <request>";

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(code)
    ? code
    : "run_failed";
}

export function formatRunOutcome(outcome: ManagedRunOutcome): string {
  const changes = outcome.managedChanges
    .map((change) => `  ${change.changeKind}  ${change.path}`)
    .join("\n");
  return [
    `Managed run을 완료했습니다. provider: ${outcome.provider}`,
    `runId: ${outcome.runId}`,
    "검증된 변경:",
    changes,
    "기능 검증: 실행하지 않음",
    "Writing 공개 검증: 실행하지 않음",
    "",
    "Provider 결과:",
    outcome.resultContent,
  ].join("\n").concat("\n");
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
        path: { type: "string" },
        root: { type: "string" },
        risk: { type: "string" },
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
  if (
    (provider !== "codex" && provider !== "claude") ||
    expectedPath === undefined ||
    instructions.length === 0
  ) {
    io.stderr(`provider, path와 작업 문장이 필요합니다.\n${runUsage}\n`);
    return 1;
  }

  try {
    const outcome = await services.executeManagedRun({
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      provider: provider as RunProvider,
      expectedPath,
      instructions,
      risk: parsed.values.risk ?? "medium",
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(outcome, null, 2)}\n`
        : formatRunOutcome(outcome),
    );
    return 0;
  } catch (error) {
    const failure = {
      code: errorCode(error),
      message: error instanceof Error ? error.message : "Managed run이 실패했습니다.",
    };
    io.stderr(
      parsed.values.json
        ? `${JSON.stringify(failure)}\n`
        : `Managed run을 완료하지 못했습니다. (${failure.code}) ${failure.message}\n`,
    );
    return 1;
  }
}
