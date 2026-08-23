import { isAbsolute } from "node:path";

import { readFirstPublicationContractFiles } from
  "./first-publication-contract-files.mjs";
import {
  createFirstPublicationExecutionPlan,
  validateFirstPublicationExecutionPlan,
} from "./first-publication-execution-plan.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_execution_plan_input_invalid",
    "The CLI first-publication execution-plan input is invalid.",
  );
}

export async function createCliFirstPublicationExecutionPlan(options, dependencies = {}) {
  if (!isAbsolute(options?.publicationAuthorizationPath ?? "") ||
      !isAbsolute(options?.bootstrapPath ?? "")) fail();
  const readSources = dependencies.readSources ?? readFirstPublicationContractFiles;
  const createPlan = dependencies.createPlan ?? createFirstPublicationExecutionPlan;
  const sources = await readSources(options);
  const plan = await createPlan(sources);
  validateFirstPublicationExecutionPlan(plan, sources);
  await sources.assertUnchanged();
  return plan;
}
