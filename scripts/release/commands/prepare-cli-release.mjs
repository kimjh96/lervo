import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  applyReleasePreparation,
  createReleasePreparationPlan,
  publicReleasePreparationPlan,
} from "../lib/release-preparation.mjs";

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
  const repositoryRoot = resolve(parsed.values.root ?? ".");
  const plan = await createReleasePreparationPlan({ repositoryRoot });
  const result = parsed.values.apply
    ? await applyReleasePreparation({ plan, approval: parsed.values.approval ?? "" })
    : publicReleasePreparationPlan(plan);
  process.stdout.write(
    parsed.values.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : parsed.values.apply
        ? `Prepared @lervo/cli ${result.version}; npm publication remains unauthorized.\n`
        : `CLI release preparation ${plan.planId}: ${plan.currentVersion} -> ${plan.nextVersion}.\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
