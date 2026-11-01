import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { writeCommandError } from "./command-error-output.js";
import { runFindReplay, writeFindReplayReport } from "./find-replay.js";
import { knowledgeUsage } from "./knowledge-usage.js";
import type { CliIo } from "./types.js";

function bounded(value: string | undefined, fallback: number, maximum: number, name: string) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum)
    throw new Error(`--${name} must be an integer from 1 to ${maximum}.`);
  return parsed;
}

const percent = (value: number | null) =>
  value === null ? "unknown" : `${Math.round(value * 100)}%`;

/** `lervo knowledge find-replay`: local, provider-free Find evaluation over past changes. */
export async function runFindReplayCommand(args: string[], io: CliIo): Promise<number> {
  let json = false;
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        cases: { type: "string" },
        limit: { type: "string" },
        json: { type: "boolean" },
      },
    });
    json = parsed.values.json === true;
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const report = await runFindReplay({
      root,
      maximumCases: bounded(parsed.values.cases, 40, 200, "cases"),
      limit: bounded(parsed.values.limit, 8, 32, "limit"),
    });
    await writeFindReplayReport(root, report);
    io.stdout(
      json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `Find replay: ${report.caseCount} past changes · recall ${percent(report.recall)} · precision ${percent(report.precision)} · hit rate ${percent(report.hitRate)} · top ${report.limit}\n`,
    );
    return 0;
  } catch (error) {
    if (json) writeCommandError(io, error, { json });
    else
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}
