import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { inspectReleaseIntent } from "../lib/release-intent-check.mjs";

try {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      base: { type: "string" },
      root: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const report = await inspectReleaseIntent({
    repositoryRoot: resolve(parsed.values.root ?? "."),
    ...(parsed.values.base === undefined ? {} : { baseRevision: parsed.values.base }),
  });
  process.stdout.write(
    parsed.values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `CLI release intent: ${report.valid ? "valid" : "invalid"}; publishable paths ${report.publishablePathCount}, intents ${report.intentIds.length}.${report.diagnostics.length ? ` ${report.diagnostics.join(", ")}.` : ""}\n`,
  );
  if (!report.valid) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
