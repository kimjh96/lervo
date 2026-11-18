import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { formatOperatingAttention } from "./operating-attention-format.js";
import { inspectOperatingAttention } from "./operating-attention-inspection.js";
import type { CliIo, CliServices } from "./types.js";

export const applicationUsage = "  lervo application attention [--root <path>] [--json]";

type ApplicationServices = Pick<CliServices, "inspectOperatingAttention">;

export async function runApplicationCommand(
  args: string[],
  io: CliIo,
  services: ApplicationServices = { inspectOperatingAttention },
): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        root: { type: "string" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${applicationUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "attention") {
      throw new Error("The application action is invalid.");
    }
    const report = await services.inspectOperatingAttention({
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatOperatingAttention(report),
    );
    return 0;
  } catch (error) {
    io.stderr(
      `Application command failed: ${error instanceof Error ? error.message : String(error)}\n${applicationUsage}\n`,
    );
    return 1;
  }
}
