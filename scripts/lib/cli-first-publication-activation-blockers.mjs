import { resolve } from "node:path";

import {
  createFirstPublicationActivationBlockerReport,
  validateFirstPublicationActivationBlockerReport,
} from "./first-publication-activation-blockers.mjs";
import { readFirstPublicationActivationSources } from
  "./first-publication-activation-sources.mjs";
import { repositoryRoot } from "./installed-cli.mjs";

export const firstPublicationActivationSourcePaths = Object.freeze({
  packageManifestPath: resolve(repositoryRoot, "apps/cli/package.json"),
  releaseManifestPath: resolve(repositoryRoot, "apps/cli/release-artifact-manifest.json"),
});

export async function inspectCliFirstPublicationActivationBlockers(
  paths = firstPublicationActivationSourcePaths,
  dependencies = {},
) {
  const readSources = dependencies.readSources ?? readFirstPublicationActivationSources;
  const createReport = dependencies.createReport ??
    createFirstPublicationActivationBlockerReport;
  const sources = await readSources(paths);
  const report = await createReport(sources);
  validateFirstPublicationActivationBlockerReport(report, sources);
  await sources.assertUnchanged();
  return report;
}
