import {
  firstPublicationActivationSourcePaths,
  readFirstPublicationActivationSources,
} from "./first-publication-activation-sources.mjs";
import {
  createFirstPublicationPackageMetadataCandidate,
  validateFirstPublicationPackageMetadataCandidate,
} from "./first-publication-package-metadata-candidate.mjs";
import { validateFirstPublicationMetadataDecision } from
  "./first-publication-metadata-decision.mjs";
import {
  createFirstPublicationMetadataPreview,
  validateFirstPublicationMetadataPreview,
} from "./first-publication-metadata-preview.mjs";

export async function inspectCliFirstPublicationPackageMetadataCandidate(
  decision,
  paths = firstPublicationActivationSourcePaths,
  dependencies = {},
) {
  validateFirstPublicationMetadataDecision(decision);
  const readSources = dependencies.readSources ?? readFirstPublicationActivationSources;
  const createPreview = dependencies.createPreview ?? createFirstPublicationMetadataPreview;
  const createCandidate = dependencies.createCandidate ??
    createFirstPublicationPackageMetadataCandidate;
  const sources = await readSources(paths);
  const previewInput = { ...sources, decision };
  const preview = await createPreview(previewInput);
  validateFirstPublicationMetadataPreview(preview, previewInput);
  const candidateInput = { ...previewInput, preview };
  const result = await createCandidate(candidateInput);
  validateFirstPublicationPackageMetadataCandidate(result, candidateInput);
  await sources.assertUnchanged();
  return result;
}
