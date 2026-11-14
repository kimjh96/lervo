import { appendFile } from "node:fs/promises";

import { CI_VERIFICATION_CONTRACT } from "./lib/ci-verification-plan.mjs";
import { aggregateCiVerification } from "./lib/ci-verification-result.mjs";

const jobs = JSON.parse(process.env.CI_JOBS);
const plan = jobs.plan.outputs;
const status = aggregateCiVerification({
  coverage: plan.coverage,
  plan: jobs.plan.result,
  quality: jobs.quality.result,
  build: jobs["release-artifacts"].result,
  tests: jobs.test.result,
  distribution: jobs.distribution.result,
  distributionRequired: plan.distribution === "true",
});
const receipt = {
  schemaVersion: 1,
  verificationContract: CI_VERIFICATION_CONTRACT,
  revision: plan.revision ?? process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  coverage: plan.coverage ?? "unknown",
  // Runs whose own jobs verified identical content; null means this run executed the component.
  reusedRuns: {
    build: plan.reuseBuild || null,
    tests: plan.reuseTests || null,
    distribution: plan.reuseDistribution || null,
  },
  status,
  jobs: Object.fromEntries(Object.entries(jobs).map(([name, job]) => [name, job.result])),
};
await appendFile(
  process.env.GITHUB_STEP_SUMMARY,
  `\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`,
);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (status !== "passed") process.exitCode = 1;
