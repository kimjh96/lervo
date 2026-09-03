import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { inspectReleaseCompletion } from "../lib/release-completion-check.mjs";

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
  const report = await inspectReleaseCompletion({
    repositoryRoot: resolve(parsed.values.root ?? "."),
    ...(parsed.values.base === undefined ? {} : { baseRevision: parsed.values.base }),
  });
  process.stdout.write(
    parsed.values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `CLI release completion: ${report.valid ? report.disposition : "blocked"}; changed paths ${report.comparison.changedPathCount}.${report.diagnostics.length ? ` ${report.diagnostics.join(", ")}.` : ""}\n`,
  );
  if (!report.valid) process.exitCode = 1;
} catch (error) {
  const code =
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^release_[a-z0-9_]+$/u.test(error.code)
      ? error.code
      : "release_completion_failed";
  process.stderr.write(`${code}: Release completion inspection failed.\n`);
  process.exitCode = 1;
}
