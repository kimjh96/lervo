import {
  createFirstPublicationActivationBlockerReport,
  validateFirstPublicationActivationBlockerReport,
} from "./first-publication-activation-blockers.mjs";
import {
  firstPublicationActivationSourcePaths,
  readFirstPublicationActivationSources,
} from "./first-publication-activation-sources.mjs";

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
