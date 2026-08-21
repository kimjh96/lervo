import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationPackageMetadataApplyPermit } from
  "./first-publication-package-metadata-apply-permit.mjs";
import { canonicalDigest, canonicalJson, sha256 } from
  "./release-artifact-manifest.mjs";

export {
  createFirstPublicationPackageMetadataApplyReceipt,
  validateFirstPublicationPackageMetadataApplyReceipt,
} from "./first-publication-package-metadata-apply-receipt.mjs";

const relativePaths = Object.freeze({
  packageManifest: "apps/cli/package.json",
  releaseManifest: "apps/cli/release-artifact-manifest.json",
  releaseSbom: "apps/cli/release-sbom.cdx.json",
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_package_metadata_apply_plan_invalid",
    "CLI 최초 게시 package metadata 적용 계획이 올바르지 않습니다.",
  );
}

function fileBinding(id, snapshot, outputBytes) {
  if (
    !Buffer.isBuffer(snapshot?.contents) ||
    snapshot.byteCount !== snapshot.contents.length ||
    snapshot.sha256 !== sha256(snapshot.contents) ||
    !Buffer.isBuffer(outputBytes) || outputBytes.length < 1
  ) fail();
  return {
    id,
    relativePath: relativePaths[id],
    before: { byteCount: snapshot.byteCount, sha256: snapshot.sha256 },
    after: { byteCount: outputBytes.length, sha256: sha256(outputBytes) },
  };
}

function sourceBinding(id, snapshot) {
  if (
    !Buffer.isBuffer(snapshot?.contents) ||
    snapshot.byteCount !== snapshot.contents.length ||
    snapshot.sha256 !== sha256(snapshot.contents)
  ) fail();
  return { id, byteCount: snapshot.byteCount, sha256: snapshot.sha256 };
}

function planBody({ permit, permitInput, derivedRelease, sourceSnapshots }) {
  try {
    validateFirstPublicationPackageMetadataApplyPermit(permit, permitInput);
  } catch {
    fail();
  }
  if (
    !Buffer.isBuffer(derivedRelease?.outputBytes?.packageManifest) ||
    !derivedRelease.outputBytes.packageManifest.equals(permitInput.candidateResult.outputBytes)
  ) fail();
  const files = [
    fileBinding(
      "packageManifest",
      sourceSnapshots?.packageManifest,
      derivedRelease.outputBytes.packageManifest,
    ),
    fileBinding(
      "releaseManifest",
      sourceSnapshots?.releaseManifest,
      derivedRelease.outputBytes.releaseManifest,
    ),
    fileBinding("releaseSbom", sourceSnapshots?.releaseSbom, derivedRelease.outputBytes.releaseSbom),
  ];
  if (
    files.some(({ before, after }) => before.sha256 === after.sha256) ||
    files[0].before.sha256 !== permit.binding.packageSourceSha256 ||
    files[0].after.sha256 !== permit.binding.outputSha256
  ) fail();
  return {
    schemaVersion: 1,
    status: "ready_to_apply",
    transactionType: "first_publication_package_metadata_apply",
    permitDigest: permit.permitDigest,
    candidateDigest: permit.binding.candidateDigest,
    readOnlySources: [
      sourceBinding("lockfile", sourceSnapshots?.lockfile),
      sourceBinding("permit", sourceSnapshots?.permit),
    ],
    files,
    strategy: {
      compareAndSwap: "all_sources_before_first_write",
      publication: "staged_replace_with_recovery_journal",
      synchronousFailure: "rollback_all_files",
      interruptedProcess: "explicit_recovery_required",
    },
    scope: "local_package_metadata_and_generated_release_sources",
    externalEffects: {
      onlineObservation: "not_run",
      approval: "not_changed",
      activation: "not_changed",
      publication: "not_attempted",
    },
  };
}

export function createFirstPublicationPackageMetadataApplyPlan(input) {
  const body = planBody(input);
  return {
    plan: { ...body, planDigest: canonicalDigest(body) },
    outputBytes: {
      packageManifest: Buffer.from(input.derivedRelease.outputBytes.packageManifest),
      releaseManifest: Buffer.from(input.derivedRelease.outputBytes.releaseManifest),
      releaseSbom: Buffer.from(input.derivedRelease.outputBytes.releaseSbom),
    },
  };
}

export function validateFirstPublicationPackageMetadataApplyPlan(result, input) {
  let expected;
  try {
    expected = createFirstPublicationPackageMetadataApplyPlan(input);
  } catch {
    fail();
  }
  if (
    canonicalJson(result?.plan) !== canonicalJson(expected.plan) ||
    Object.keys(expected.outputBytes).some((id) =>
      !Buffer.isBuffer(result?.outputBytes?.[id]) ||
      !result.outputBytes[id].equals(expected.outputBytes[id])
    )
  ) fail();
  return result;
}
