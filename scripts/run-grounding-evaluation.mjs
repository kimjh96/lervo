import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertGroundingEvaluationPassed,
  runGroundingEvaluation,
} from "./natural-language-evaluation/grounding-runner.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suitePath = resolve(
  repositoryRoot,
  "benchmarks/grounding/natural-language-repository-v1.json",
);
const suite = JSON.parse(readFileSync(suitePath, "utf8"));
const report = runGroundingEvaluation(suite);
assertGroundingEvaluationPassed(report);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `Grounding evaluation passed (${report.summary.passed}/${report.summary.total} cases, report ${report.reportId})`,
  );
}
