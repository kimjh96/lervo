import { readFile } from "node:fs/promises";

import { renderReleasePrBody } from "../lib/release-pr-body.mjs";

const existingBody = process.env.RELEASE_EXISTING_PR_BODY_PATH
  ? JSON.parse(await readFile(process.env.RELEASE_EXISTING_PR_BODY_PATH, "utf8")).body
  : undefined;
process.stdout.write(
  renderReleasePrBody({
    repository: process.env.GITHUB_REPOSITORY,
    sourceRevision: process.env.RELEASE_SOURCE_SHA,
    releaseRevision: process.env.RELEASE_CANDIDATE_SHA,
    planId: process.env.RELEASE_PLAN_ID,
    runId: process.env.GITHUB_RUN_ID,
    existingBody,
  }),
);
