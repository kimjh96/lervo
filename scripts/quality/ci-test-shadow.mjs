import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runCiTestShadow } from "./lib/ci-test-shadow-run.mjs";

// Usage: ci-test-shadow.mjs <current ledger directory> <output directory>
// Observation only (ADR-0565, Stage 2): any failure prints one line and still exits 0.
const [ledgerDirectory, outputDirectory] = process.argv.slice(2);
try {
  if (!ledgerDirectory || !outputDirectory) throw new Error("ci_test_shadow_usage");
  const { report, markdown } = await runCiTestShadow({
    repositoryRoot: resolve(import.meta.dirname, "../.."),
    repository: process.env.GITHUB_REPOSITORY ?? "",
    ledgerDirectory: resolve(ledgerDirectory),
    outputDirectory: resolve(outputDirectory),
  });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(`${JSON.stringify(report.summary)}\n`);
} catch (error) {
  process.stdout.write(`CI test shadow report not written: ${error?.message ?? error}\n`);
}
