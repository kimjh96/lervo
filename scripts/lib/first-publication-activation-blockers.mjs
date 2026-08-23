import {
  canonicalDigest,
  canonicalJson,
  validateReleaseArtifactManifest,
} from "./release-artifact-manifest.mjs";
import { inspectFirstPublicationActivationLocalMetadata } from
  "./first-publication-activation-local-policy.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";

const externalRequirements = Object.freeze([
  {
    id: "public_package_availability",
    status: "required",
    reason: "online_observation_required",
  },
  {
    id: "npm_scope_control",
    status: "required",
    reason: "scope_owner_confirmation_required",
  },
  {
    id: "first_publication_approval",
    status: "required",
    reason: "explicit_approval_required",
  },
].map(Object.freeze));

const sideEffects = Object.freeze({
  onlineObservation: "not_run",
  metadata: "not_changed",
  approval: "not_created",
  activation: "not_changed",
  publication: "not_attempted",
});

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_activation_blocker_report_invalid",
    "The CLI first-publication activation-blocker report is invalid.",
  );
}

function reportBody({ packageManifest, releaseManifest }) {
  if (
    packageManifest === null || typeof packageManifest !== "object" ||
    Array.isArray(packageManifest) ||
    releaseManifest === null || typeof releaseManifest !== "object" ||
    Array.isArray(releaseManifest)
  ) fail();
  try {
    validateReleaseArtifactManifest(releaseManifest);
  } catch {
    fail();
  }
  const local = inspectFirstPublicationActivationLocalMetadata({
    packageManifest,
    releaseManifest,
  });
  return {
    schemaVersion: 1,
    status: "blocked",
    activation: "not_implemented",
    advisoryOnly: true,
    target: local.target,
    sources: {
      packageManifestDigest: canonicalDigest(packageManifest),
      releaseManifestDigest: canonicalDigest(releaseManifest),
    },
    localStatus: local.localStatus,
    localChecks: local.localChecks,
    externalRequirements: structuredClone(externalRequirements),
    sideEffects: structuredClone(sideEffects),
  };
}

export function createFirstPublicationActivationBlockerReport(sources) {
  const body = reportBody(sources);
  return { ...body, blockerReportDigest: canonicalDigest(body) };
}

export function validateFirstPublicationActivationBlockerReport(report, sources) {
  let expected;
  try {
    expected = createFirstPublicationActivationBlockerReport(sources);
  } catch {
    fail();
  }
  if (canonicalJson(report) !== canonicalJson(expected)) fail();
  return report;
}
