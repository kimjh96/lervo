import {
  createValidatedFirstPublicationPackageMetadataCandidateEvidence,
} from "./cli-first-publication-package-metadata-candidate.mjs";
import {
  firstPublicationActivationSourcePaths,
  readFirstPublicationActivationSources,
} from "./first-publication-activation-sources.mjs";
import {
  createFirstPublicationPackageMetadataApplyPermit,
  validateFirstPublicationPackageMetadataApplyPermit,
} from "./first-publication-package-metadata-apply-permit.mjs";
import { validateFirstPublicationMetadataDecision } from
  "./first-publication-metadata-decision.mjs";

export async function inspectCliFirstPublicationPackageMetadataApplyPermit(
  decision,
  review,
  paths = firstPublicationActivationSourcePaths,
  dependencies = {},
) {
  validateFirstPublicationMetadataDecision(decision);
  const readSources = dependencies.readSources ?? readFirstPublicationActivationSources;
  const createPermit = dependencies.createPermit ??
    createFirstPublicationPackageMetadataApplyPermit;
  const sources = await readSources(paths);
  const evidence = await createValidatedFirstPublicationPackageMetadataCandidateEvidence(
    decision,
    sources,
    dependencies,
  );
  const input = { ...evidence, decision, review };
  const permit = await createPermit(input);
  validateFirstPublicationPackageMetadataApplyPermit(permit, input);
  await sources.assertUnchanged();
  return permit;
}
