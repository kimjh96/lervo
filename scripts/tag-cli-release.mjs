import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { applyReleaseTag, createReleaseTagPlan } from "./lib/release-tag.mjs";

try {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      apply: { type: "boolean" },
      approval: { type: "string" },
      root: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const plan = await createReleaseTagPlan({ repositoryRoot: resolve(parsed.values.root ?? ".") });
  const result = parsed.values.apply
    ? await applyReleaseTag({ plan, approval: parsed.values.approval ?? "" })
    : plan;
  process.stdout.write(
    parsed.values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : parsed.values.apply
        ? `Release tag ${result.tag}: ${result.disposition}; publication not authorized.\n`
        : `Release tag ${plan.tag}: ${plan.status}${plan.blockers.length ? ` (${plan.blockers.join(", ")})` : ""}.\n`,
  );
  if (!parsed.values.apply && plan.status === "blocked") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
