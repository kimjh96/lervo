import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  foundationReadinessChecks,
  hashFoundationReadinessSuites,
} from "./readiness/check-bindings.mjs";
import { runFoundationCommand } from "./readiness/command-runner.mjs";
import { createFoundationReadinessReport } from "./readiness/report.mjs";
import { foundationSourceRevision } from "./evidence/source-revision.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const parsed = parseArgs({
  args,
  strict: true,
  options: {
    write: { type: "string" },
    summary: { type: "boolean" },
    base: { type: "string" },
  },
});
if (!parsed.values.base) throw new TypeError("Foundation readiness run requires --base.");

async function constituentReport(path) {
  const content = await readFile(resolve(repositoryRoot, path));
  const parsedReport = JSON.parse(content.toString("utf8"));
  return {
    path,
    reportId: parsedReport.reportId,
    contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
  };
}

const repositoryRevision = await foundationSourceRevision(repositoryRoot);
const observations = [];
for (let sequence = 1; sequence <= 3; sequence += 1) {
  const checks = [];
  for (const check of foundationReadinessChecks) {
    checks.push(await runFoundationCommand({ ...check, repositoryRoot }));
  }
  checks.push(
    await runFoundationCommand({
      checkId: "release_completion",
      command: "pnpm",
      args: ["release:completion:check", "--base", parsed.values.base],
      repositoryRoot,
    }),
  );
  if ((await foundationSourceRevision(repositoryRoot)) !== repositoryRevision) {
    throw new Error("Foundation source bytes changed during readiness observation.");
  }
  observations.push({
    sequence,
    observedAt: new Date().toISOString(),
    repositoryRevision,
    status: "passed",
    checks,
  });
}
const checkIds = [...foundationReadinessChecks.map((item) => item.checkId), "release_completion"];
const report = createFoundationReadinessReport({
  repositoryRevision,
  releaseBaseRevision: parsed.values.base,
  environment: { operatingSystem: platform(), architecture: arch(), nodeVersion: process.version },
  constituentReports: await Promise.all([
    constituentReport("docs/evidence/foundation/execution-performance-v1.json"),
    constituentReport("docs/evidence/foundation/adverse-condition-v1.json"),
  ]),
  suiteBindings: await hashFoundationReadinessSuites(repositoryRoot),
  checkIds,
  unsupportedStates: [
    "direct provider sessions remain unmanaged and whole-task usage is unavailable",
    "arbitrary third-party code execution remains disabled pending isolation",
    "live external provider and multi-machine production availability are not claimed",
    "billing reconciliation and autonomous monetary hard stops are not implemented",
  ],
  observations,
});
const output = `${JSON.stringify(report, null, 2)}\n`;
if (parsed.values.write) await writeFile(resolve(repositoryRoot, parsed.values.write), output);
process.stdout.write(
  parsed.values.summary
    ? `${JSON.stringify({ reportId: report.reportId, allPassed: true, observations: 3, checksPerObservation: checkIds.length }, null, 2)}\n`
    : output,
);
