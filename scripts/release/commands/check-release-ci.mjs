import { appendFile, readdir } from "node:fs/promises";

import { observeReleaseCi } from "../lib/ci-release-observation.mjs";

const tagOnlyPlan =
  process.argv.includes("--plan") &&
  !(await readdir(new URL("../../../.changes/", import.meta.url))).some((name) =>
    name.endsWith(".yaml"),
  );
const result = observeReleaseCi({
  repository: process.env.GITHUB_REPOSITORY,
  revision: process.env.RELEASE_SOURCE_SHA,
  runId: process.env.RELEASE_CI_RUN_ID,
  requireFull: process.argv.includes("--full") || tagOnlyPlan,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
if (process.argv.includes("--plan"))
  await appendFile(process.env.GITHUB_OUTPUT, `status=${result.status}\nreason=${result.reason}\n`);
else if (result.status !== "ready") process.exitCode = 1;
