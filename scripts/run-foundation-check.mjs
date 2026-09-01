import { resolve } from "node:path";

import { foundationReadinessChecks } from "./foundation-readiness/check-bindings.mjs";
import { runFoundationCommand } from "./foundation-readiness/command-runner.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
for (const check of foundationReadinessChecks) {
  await runFoundationCommand({ ...check, repositoryRoot });
}
await runFoundationCommand({
  checkId: "readiness_evidence",
  command: process.execPath,
  args: [resolve(repositoryRoot, "scripts/check-foundation-readiness.mjs")],
  repositoryRoot,
});
process.stdout.write("Foundation aggregate check passed.\n");
