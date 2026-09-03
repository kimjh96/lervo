import {
  firstPublicationActivationSourcePaths,
  readFirstPublicationActivationSources,
} from "../shared/first-publication-activation-sources.mjs";
import {
  createFirstPublicationPackageMetadataCandidate,
  validateFirstPublicationPackageMetadataCandidate,
} from "./first-publication-package-metadata-candidate.mjs";
import { validateFirstPublicationMetadataDecision } from "./first-publication-metadata-decision.mjs";
import {
  createFirstPublicationMetadataPreview,
  validateFirstPublicationMetadataPreview,
} from "./first-publication-metadata-preview.mjs";

export async function createValidatedFirstPublicationPackageMetadataCandidateEvidence(
  decision,
  sources,
  dependencies = {},
) {
  validateFirstPublicationMetadataDecision(decision);
  const createPreview = dependencies.createPreview ?? createFirstPublicationMetadataPreview;
  const createCandidate =
    dependencies.createCandidate ?? createFirstPublicationPackageMetadataCandidate;
  const previewInput = { ...sources, decision };
  const preview = await createPreview(previewInput);
  validateFirstPublicationMetadataPreview(preview, previewInput);
  const candidateInput = { ...previewInput, preview };
  const result = await createCandidate(candidateInput);
  validateFirstPublicationPackageMetadataCandidate(result, candidateInput);
  return { candidateResult: result, candidateSources: candidateInput };
}

export async function createValidatedFirstPublicationPackageMetadataCandidate(
  decision,
  sources,
  dependencies = {},
) {
  const evidence = await createValidatedFirstPublicationPackageMetadataCandidateEvidence(
    decision,
    sources,
    dependencies,
  );
  return evidence.candidateResult;
}

export async function inspectCliFirstPublicationPackageMetadataCandidate(
  decision,
  paths = firstPublicationActivationSourcePaths,
  dependencies = {},
) {
  validateFirstPublicationMetadataDecision(decision);
  const readSources = dependencies.readSources ?? readFirstPublicationActivationSources;
  const sources = await readSources(paths);
  const result = await createValidatedFirstPublicationPackageMetadataCandidate(
    decision,
    sources,
    dependencies,
  );
  await sources.assertUnchanged();
  return result;
}
