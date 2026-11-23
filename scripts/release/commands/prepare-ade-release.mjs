// Prepares the next ADE release inside its pull request (ADR-0615): it consumes the intents in
// `.changes/ade/`, writes the version to every ADE manifest, and replaces the ADE release notes.
// Commit the result as `chore(ade): prepare release`.
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { applyAdeRelease, planAdeRelease } from "../lib/ade-release.mjs";

try {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { root: { type: "string" }, json: { type: "boolean" } },
  });
  const root = resolve(values.root ?? ".");
  const plan = await planAdeRelease(root);
  if (plan !== null) await applyAdeRelease(root, plan);
  const report =
    plan === null
      ? { prepared: false }
      : { prepared: true, from: plan.current, version: plan.version, intents: plan.intents.length };
  process.stdout.write(
    values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : plan === null
        ? "No ADE release intent is pending.\n"
        : `Prepared ADE ${plan.version} from ${plan.current} with ${plan.intents.length} intent(s).\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
