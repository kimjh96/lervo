import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CI_VERIFICATION_CONTRACT } from "./lib/ci-verification-plan.mjs";

/** Writes one small receipt per component this run executed itself, for later runs to find. */
const directory = process.argv[2];
const jobs = JSON.parse(process.env.CI_JOBS);
const plan = jobs.plan.outputs;
const executed = {
  build: !plan.reuseBuild && jobs["release-artifacts"].result === "success",
  tests: !plan.reuseTests && jobs.test.result === "success",
  distribution: !plan.reuseDistribution && jobs.distribution.result === "success",
};
await mkdir(directory, { recursive: true });
for (const [component, ran] of Object.entries(executed)) {
  if (!ran) continue;
  await writeFile(
    resolve(directory, `${component}.json`),
    `${JSON.stringify({
      schemaVersion: 1,
      verificationContract: CI_VERIFICATION_CONTRACT,
      component,
      digest: component === "tests" ? plan.testDigest : plan.tree,
      revision: plan.revision,
      runId: process.env.GITHUB_RUN_ID,
    })}\n`,
  );
}
process.stdout.write(`${JSON.stringify(executed)}\n`);
