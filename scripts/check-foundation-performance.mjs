import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyExecutionPerformanceReport } from "../packages/execution-performance/dist/index.js";
import { foundationPerformanceSourceRevision } from "./foundation-performance/source-revision.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const evidencePath = resolve(
  import.meta.dirname,
  "../docs/evidence/foundation/execution-performance-v1.json",
);
const report = verifyExecutionPerformanceReport(JSON.parse(await readFile(evidencePath, "utf8")));
if (report.repositoryRevision !== (await foundationPerformanceSourceRevision(repositoryRoot))) {
  throw new Error("Foundation execution performance evidence does not match current source bytes.");
}
if (!report.allProfilesPassed) {
  throw new Error("Foundation execution performance evidence does not pass every profile.");
}
process.stdout.write(
  `Foundation performance evidence passed: ${report.reportId} (${report.profiles.length} profiles, ${report.repetitions} paired repetitions each).\n`,
);
