import { resolve } from "node:path";

import {
  createFirstPublicationWorkflowActivationCandidate,
  validateFirstPublicationWorkflowActivationCandidate,
} from "./first-publication-workflow-activation-candidate.mjs";
import { readFirstPublicationWorkflowActivationSources } from "./first-publication-workflow-activation-sources.mjs";
import { repositoryRoot } from "./installed-cli.mjs";

export const workflowActivationSourcePaths = Object.freeze({
  packageManifestPath: resolve(repositoryRoot, "package.json"),
  workflowPath: resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml"),
});

export async function inspectCliFirstPublicationWorkflowActivationCandidate(
  paths = workflowActivationSourcePaths,
  dependencies = {},
) {
  const readSources = dependencies.readSources ?? readFirstPublicationWorkflowActivationSources;
  const createCandidate =
    dependencies.createCandidate ?? createFirstPublicationWorkflowActivationCandidate;
  const sources = await readSources(paths);
  const input = {
    packageManifest: sources.packageManifest,
    workflow: sources.workflow,
    packageSnapshot: sources.packageSnapshot,
    workflowSnapshot: sources.workflowSnapshot,
  };
  const result = await createCandidate(input);
  validateFirstPublicationWorkflowActivationCandidate(result, input);
  await sources.assertUnchanged();
  return result;
}
