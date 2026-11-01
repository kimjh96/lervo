import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createValidatedFirstPublicationPackageMetadataCandidateEvidence } from "../../metadata/cli-first-publication-package-metadata-candidate.mjs";
import { readFirstPublicationActivationSources } from "../../shared/first-publication-activation-sources.mjs";
import { readFirstPublicationPackageMetadataApplySources } from "../../metadata/first-publication-package-metadata-apply-sources.mjs";
import { createFirstPublicationMetadataDecision } from "../../metadata/first-publication-metadata-decision.mjs";
import { createFirstPublicationPackageMetadataApplyPermit } from "../../metadata/first-publication-package-metadata-apply-permit.mjs";
import {
  createFirstPublicationPackageMetadataDerivedRelease,
  parseFirstPublicationPackageMetadataLockfile,
} from "../../metadata/first-publication-package-metadata-derived-release.mjs";
import {
  createFirstPublicationPackageMetadataApplyPlan,
  createFirstPublicationPackageMetadataApplyReceipt,
} from "../../metadata/first-publication-package-metadata-apply-transaction.mjs";
import { applyFirstPublicationPackageMetadataFiles } from "../../metadata/first-publication-package-metadata-apply-filesystem.mjs";
import { generateFirstPublicationPackageMetadataPostApplyRelease } from "../../metadata/first-publication-package-metadata-post-apply-release.mjs";
import { createCliReleaseSbom } from "../../../lib/cli-release-sbom.mjs";
import { releaseArtifactDigest } from "../../../../shared/release-artifact-manifest.mjs";
import {
  activationRepository,
  activationRepositoryRoot,
  createActivationSourceFiles,
  currentActivationSources,
} from "./first-publication-activation.mjs";

function decision() {
  return createFirstPublicationMetadataDecision({
    repository: activationRepository,
    license: "Apache-2.0",
    scopeOwnerKind: "organization",
    scopeOwnerName: "lervo",
  });
}

function reviewFor(candidateResult) {
  return {
    actorKind: "human_operator",
    confirmation: "reviewed_exact_candidate",
    candidateDigest: candidateResult.candidate.candidateDigest,
    packageSourceSha256: candidateResult.candidate.sources.packageSourceSha256,
    outputSha256: candidateResult.candidate.output.sha256,
  };
}

function generatedManifest(current, candidateResult) {
  const output = JSON.parse(candidateResult.outputBytes.toString("utf8"));
  const generated = structuredClone(current);
  generated.artifact.description = output.description;
  generated.artifact.repository = output.repository.url;
  generated.artifact.license = output.license;
  generated.artifact.registry = output.publishConfig.registry;
  generated.artifact.provenance = output.publishConfig.provenance;
  generated.artifactDigest = releaseArtifactDigest(generated);
  return generated;
}

/**
 * Release sources that the production generator reproduces from the local build, so a test that
 * compares generator output does not also require the build to match the committed manifest.
 * `pnpm release:manifest:check` owns that committed-manifest comparison.
 */
export async function currentBuildMetadataSources() {
  const committed = await currentActivationSources();
  const releaseManifest = await generateFirstPublicationPackageMetadataPostApplyRelease(committed);
  const lockfile = parseFirstPublicationPackageMetadataLockfile(
    await readFile(resolve(activationRepositoryRoot, "pnpm-lock.yaml")),
  );
  return {
    packageManifest: committed.packageManifest,
    releaseManifest,
    releaseSbom: createCliReleaseSbom(releaseManifest, lockfile),
  };
}

export async function createMetadataApplyFixture(baseline) {
  const prepared = await createActivationSourceFiles(baseline);
  const paths = {
    ...prepared.paths,
    releaseSbomPath: resolve(prepared.root, "release-sbom.cdx.json"),
    lockfilePath: resolve(prepared.root, "pnpm-lock.yaml"),
  };
  const permitPath = resolve(prepared.root, "permit.json");
  const transactionRoot = resolve(prepared.root, ".metadata-apply-transaction");
  await Promise.all([
    (baseline?.releaseSbom === undefined
      ? readFile(resolve(activationRepositoryRoot, "apps/cli/release-sbom.cdx.json"))
      : Promise.resolve(`${JSON.stringify(baseline.releaseSbom, null, 2)}\n`)
    ).then((contents) => writeFile(paths.releaseSbomPath, contents)),
    readFile(resolve(activationRepositoryRoot, "pnpm-lock.yaml")).then((contents) =>
      writeFile(paths.lockfilePath, contents),
    ),
  ]);
  const selected = decision();
  const activationSources = await readFirstPublicationActivationSources(paths);
  const candidateEvidence = await createValidatedFirstPublicationPackageMetadataCandidateEvidence(
    selected,
    activationSources,
  );
  const review = reviewFor(candidateEvidence.candidateResult);
  const permitInput = { ...candidateEvidence, decision: selected, review };
  const permit = createFirstPublicationPackageMetadataApplyPermit(permitInput);
  await writeFile(permitPath, `${JSON.stringify(permit, null, 2)}\n`);
  const sources = await readFirstPublicationPackageMetadataApplySources(paths, permitPath);
  const lockfile = parseFirstPublicationPackageMetadataLockfile(
    sources.sourceSnapshots.lockfile.contents,
  );
  const derivedRelease = createFirstPublicationPackageMetadataDerivedRelease({
    currentReleaseManifest: sources.releaseManifest,
    currentReleaseSbom: sources.releaseSbom,
    lockfile,
    candidateResult: candidateEvidence.candidateResult,
    generatedReleaseManifest: generatedManifest(
      sources.releaseManifest,
      candidateEvidence.candidateResult,
    ),
  });
  const planInput = {
    permit,
    permitInput,
    derivedRelease,
    sourceSnapshots: sources.sourceSnapshots,
  };
  const planResult = createFirstPublicationPackageMetadataApplyPlan(planInput);
  const targets = {
    packageManifest: paths.packageManifestPath,
    releaseManifest: paths.releaseManifestPath,
    releaseSbom: paths.releaseSbomPath,
  };
  return {
    ...prepared,
    paths,
    permitPath,
    transactionRoot,
    selected,
    permit,
    sources,
    candidateEvidence,
    lockfile,
    derivedRelease,
    planInput,
    planResult,
    targets,
  };
}

export function applyFilesystemInput(fixture) {
  return {
    transactionRoot: fixture.transactionRoot,
    plan: fixture.planResult.plan,
    files: fixture.planResult.plan.files.map((binding) => ({
      path: fixture.targets[binding.id],
      binding,
      outputBytes: fixture.planResult.outputBytes[binding.id],
    })),
    readOnlyFiles: fixture.planResult.plan.readOnlySources.map((binding) => ({
      path: binding.id === "lockfile" ? fixture.paths.lockfilePath : fixture.permitPath,
      binding: { before: binding },
    })),
  };
}

export async function applyMetadataFixture(fixture) {
  await applyFirstPublicationPackageMetadataFiles(applyFilesystemInput(fixture));
  const receipt = createFirstPublicationPackageMetadataApplyReceipt(fixture.planResult.plan);
  const receiptPath = resolve(fixture.root, "apply-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, receiptPath };
}
