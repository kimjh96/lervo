import { resolve } from "node:path";

import { createValidatedFirstPublicationPackageMetadataCandidateEvidence } from
  "./cli-first-publication-package-metadata-candidate.mjs";
import {
  applyFirstPublicationPackageMetadataFiles,
  assertNoFirstPublicationPackageMetadataTransaction,
} from "./first-publication-package-metadata-apply-filesystem.mjs";
import { recoverFirstPublicationPackageMetadataFiles } from
  "./first-publication-package-metadata-apply-recovery.mjs";
import {
  firstPublicationPackageMetadataApplySourcePaths,
  readFirstPublicationPackageMetadataApplySources,
} from "./first-publication-package-metadata-apply-sources.mjs";
import {
  generateFirstPublicationPackageMetadataDerivedRelease,
  parseFirstPublicationPackageMetadataLockfile,
} from "./first-publication-package-metadata-derived-release.mjs";
import { createFirstPublicationMetadataDecision } from
  "./first-publication-metadata-decision.mjs";
import {
  createFirstPublicationPackageMetadataApplyPlan,
  createFirstPublicationPackageMetadataApplyReceipt,
  validateFirstPublicationPackageMetadataApplyPlan,
  validateFirstPublicationPackageMetadataApplyReceipt,
} from "./first-publication-package-metadata-apply-transaction.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";
import { repositoryRoot } from "./installed-cli.mjs";

export const firstPublicationPackageMetadataTransactionRoot = resolve(
  repositoryRoot,
  "apps/cli/.lervo-metadata-apply-transaction",
);

function decisionFromPermit(permit) {
  return createFirstPublicationMetadataDecision({
    repository: permit?.selection?.repository,
    license: permit?.selection?.license,
    scopeOwnerKind: permit?.selection?.scopeOwner?.kind,
    scopeOwnerName: permit?.selection?.scopeOwner?.name,
  });
}

function reviewFromPermit(permit) {
  return {
    actorKind: permit?.review?.actorKind,
    confirmation: permit?.review?.confirmation,
    candidateDigest: permit?.binding?.candidateDigest,
    packageSourceSha256: permit?.binding?.packageSourceSha256,
    outputSha256: permit?.binding?.outputSha256,
  };
}

function targetPaths(paths) {
  return {
    packageManifest: paths.packageManifestPath,
    releaseManifest: paths.releaseManifestPath,
    releaseSbom: paths.releaseSbomPath,
  };
}

export async function applyCliFirstPublicationPackageMetadata(
  permitPath,
  paths = firstPublicationPackageMetadataApplySourcePaths,
  dependencies = {},
) {
  const transactionRoot = dependencies.transactionRoot ??
    firstPublicationPackageMetadataTransactionRoot;
  const assertNoTransaction = dependencies.assertNoTransaction ??
    assertNoFirstPublicationPackageMetadataTransaction;
  await assertNoTransaction(transactionRoot);
  const readSources = dependencies.readSources ??
    readFirstPublicationPackageMetadataApplySources;
  const sources = await readSources(paths, permitPath);
  const decision = decisionFromPermit(sources.permit);
  const candidateEvidence = await createValidatedFirstPublicationPackageMetadataCandidateEvidence(
    decision,
    sources,
    dependencies,
  );
  const permitInput = {
    ...candidateEvidence,
    decision,
    review: reviewFromPermit(sources.permit),
  };
  const lockfile = parseFirstPublicationPackageMetadataLockfile(
    sources.sourceSnapshots.lockfile.contents,
  );
  const generateDerived = dependencies.generateDerived ??
    generateFirstPublicationPackageMetadataDerivedRelease;
  const derivedRelease = await generateDerived({
    currentReleaseManifest: sources.releaseManifest,
    currentReleaseSbom: sources.releaseSbom,
    lockfile,
    candidateResult: candidateEvidence.candidateResult,
  }, dependencies);
  const planInput = {
    permit: sources.permit,
    permitInput,
    derivedRelease,
    sourceSnapshots: sources.sourceSnapshots,
  };
  const planResult = createFirstPublicationPackageMetadataApplyPlan(planInput);
  validateFirstPublicationPackageMetadataApplyPlan(planResult, planInput);
  await sources.assertUnchanged();
  const targets = targetPaths(paths);
  const applyFiles = dependencies.applyFiles ?? applyFirstPublicationPackageMetadataFiles;
  const transaction = await applyFiles({
    transactionRoot,
    plan: planResult.plan,
    files: planResult.plan.files.map((binding) => ({
      path: targets[binding.id],
      binding,
      outputBytes: planResult.outputBytes[binding.id],
    })),
    readOnlyFiles: planResult.plan.readOnlySources.map((binding) => ({
      path: binding.id === "lockfile" ? paths.lockfilePath : permitPath,
      binding: { before: binding },
    })),
  }, dependencies);
  if (canonicalJson(transaction) !== canonicalJson({
    journal: "removed",
    rollback: "not_required",
    recovery: "not_required",
  })) throw new Error("unexpected metadata apply transaction result");
  const receipt = createFirstPublicationPackageMetadataApplyReceipt(planResult.plan);
  return validateFirstPublicationPackageMetadataApplyReceipt(receipt, planResult.plan);
}

export async function recoverCliFirstPublicationPackageMetadata(
  paths = firstPublicationPackageMetadataApplySourcePaths,
  dependencies = {},
) {
  const transactionRoot = dependencies.transactionRoot ??
    firstPublicationPackageMetadataTransactionRoot;
  const recoverFiles = dependencies.recoverFiles ??
    recoverFirstPublicationPackageMetadataFiles;
  return recoverFiles({ transactionRoot, targets: targetPaths(paths) });
}
