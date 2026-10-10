import { auditCasePopulation } from "./lib/context-quality-case-audit.mjs";
import { diagnoseReviewedCases } from "./lib/context-quality-case-diagnosis.mjs";
const root = process.cwd();
if (process.argv.length !== 2) throw new Error("Usage: run-context-quality-case-audit.mjs");
const { suite, report } = await auditCasePopulation(root);
const diagnosis = await diagnoseReviewedCases(root, suite);
process.stdout.write(JSON.stringify({ ...report, diagnosis }, null, 2) + "\n");
