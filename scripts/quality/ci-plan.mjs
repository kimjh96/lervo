import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCiVerificationPlan } from "./lib/ci-verification-plan.mjs";

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const plan = createCiVerificationPlan({
  repositoryRoot: resolve(import.meta.dirname, "../.."),
  event: { ...event, eventName: process.env.GITHUB_EVENT_NAME },
  expectedRevision: process.env.EXPECTED_REVISION ?? "",
});
await appendFile(
  process.env.GITHUB_OUTPUT,
  Object.entries(plan)
    .map(([key, value]) => `${key}=${value}\n`)
    .join(""),
);
process.stdout.write(`${JSON.stringify(plan)}\n`);
