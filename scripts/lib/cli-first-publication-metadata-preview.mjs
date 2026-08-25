import {
  firstPublicationActivationSourcePaths,
  readFirstPublicationActivationSources,
} from "./first-publication-activation-sources.mjs";
import { validateFirstPublicationMetadataDecision } from "./first-publication-metadata-decision.mjs";
import {
  createFirstPublicationMetadataPreview,
  validateFirstPublicationMetadataPreview,
} from "./first-publication-metadata-preview.mjs";

export async function inspectCliFirstPublicationMetadataPreview(
  decision,
  paths = firstPublicationActivationSourcePaths,
  dependencies = {},
) {
  validateFirstPublicationMetadataDecision(decision);
  const readSources = dependencies.readSources ?? readFirstPublicationActivationSources;
  const createPreview = dependencies.createPreview ?? createFirstPublicationMetadataPreview;
  const sources = await readSources(paths);
  const input = { ...sources, decision };
  const preview = await createPreview(input);
  validateFirstPublicationMetadataPreview(preview, input);
  await sources.assertUnchanged();
  return preview;
}
