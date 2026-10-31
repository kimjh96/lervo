import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

import { computeCiContentDigests } from "./lib/ci-content-digest.mjs";
import { findReusableRun, planCiReuse } from "./lib/ci-reuse-receipts.mjs";

const repository = process.env.GITHUB_REPOSITORY;
const digests = computeCiContentDigests({
  repositoryRoot: resolve(import.meta.dirname, "../.."),
  revision: "HEAD",
});
const reuse = planCiReuse({
  coverage: process.env.COVERAGE,
  distributionRequired: process.env.DISTRIBUTION_REQUIRED === "true",
  digests,
  find: (component, digest) => findReusableRun({ repository, component, digest }),
});
const outputs = {
  tree: digests.tree,
  testDigest: digests.tests,
  reuseQuality: String(reuse.quality),
  reuseBuild: reuse.build ?? "",
  reuseTests: reuse.tests ?? "",
  reuseDistribution: reuse.distribution ?? "",
};
await appendFile(
  process.env.GITHUB_OUTPUT,
  Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join(""),
);
process.stdout.write(`${JSON.stringify(outputs)}\n`);
