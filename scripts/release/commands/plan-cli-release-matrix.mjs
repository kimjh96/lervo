import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  findVerifiedReleaseRun,
  planReleaseMatrix,
  ReleaseMatrixPlanError,
} from "../lib/cli-release-matrix-reuse.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const git = (...args) =>
  execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
const githubApi = (path) =>
  JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));

try {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const plan = planReleaseMatrix({
    refType: process.env.GITHUB_REF_TYPE ?? "",
    expectedRevision: process.env.EXPECTED_REVISION ?? "",
    revision: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    find: (tree) => findVerifiedReleaseRun({ repository, tree, request: githubApi }),
  });
  await appendFile(process.env.GITHUB_OUTPUT, `tree=${plan.tree}\nreuse=${plan.reuse}\n`);
  process.stdout.write(`${JSON.stringify(plan)}\n`);
} catch (error) {
  if (error instanceof ReleaseMatrixPlanError) console.error(`${error.code}: ${error.message}`);
  else console.error("release_matrix_plan_failed: The release matrix plan could not complete.");
  process.exitCode = 1;
}
