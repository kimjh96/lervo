import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { format, resolveConfig } from "prettier";

import {
  comparePlatformBoundary,
  lowerPlatformBoundaryBaseline,
  observePlatformBoundary,
  platformBoundaryTotals,
} from "./lib/platform-boundary.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const baselinePath = resolve(import.meta.dirname, "platform-boundary-baseline.json");
const refresh = process.argv.slice(2).includes("--refresh-baseline");

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const observation = await observePlatformBoundary({ repositoryRoot });

function summary(value) {
  return Object.entries(platformBoundaryTotals(value))
    .map(([platform, totals]) => `${platform} ${totals.lines} lines in ${totals.files} files`)
    .join(", ");
}

if (refresh) {
  const result = lowerPlatformBoundaryBaseline({ baseline, observation });
  if (result.status === "refused") {
    process.stderr.write(
      `Platform boundary baseline refresh refused; it can only decrease (${result.issues.length}):\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    const formatted = await format(JSON.stringify(result.baseline), {
      ...(await resolveConfig(baselinePath)),
      parser: "json",
    });
    await writeFile(baselinePath, formatted);
    process.stdout.write(`Platform boundary baseline lowered to ${summary(result.baseline)}.\n`);
  }
} else {
  const issues = comparePlatformBoundary({ baseline, observation });
  if (issues.length > 0) {
    process.stderr.write(
      `Platform boundary ratchet failed (${issues.length}):\n${issues.map((issue) => `  - ${issue}`).join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Platform boundary ratchet passed (baseline ${summary(baseline)}).\n`);
  }
}
