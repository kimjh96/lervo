// Fails when the ADE's versions disagree or its release notes name another version (ADR-0615).
import { resolve } from "node:path";

import { checkAdeRelease } from "../lib/ade-release.mjs";

try {
  const report = await checkAdeRelease(resolve(process.argv[2] ?? "."));
  process.stdout.write(
    report.valid
      ? `ADE release files agree on ${report.version}; ${report.pending} intent(s) pending.\n`
      : `${report.diagnostics.join("\n")}\n`,
  );
  if (!report.valid) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
