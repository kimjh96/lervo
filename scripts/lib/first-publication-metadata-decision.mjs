import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

const licenseMaximumLength = 128;
export const cliEnglishDescription =
  "Lervo CLI for managing AI agent execution and evidence in local repositories";

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_metadata_decision_invalid",
    "The CLI first-publication metadata decision input is invalid.",
  );
}

function validateLicense(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > licenseMaximumLength ||
    value !== value.trim() ||
    value === "UNLICENSED" ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  )
    fail();
  return value;
}

function decisionBody({ repository, license, scopeOwnerKind, scopeOwnerName }) {
  let validatedRepository;
  try {
    validatedRepository = validateReadinessRepository(repository);
  } catch {
    fail();
  }
  if (!["organization", "user"].includes(scopeOwnerKind) || scopeOwnerName !== "lervo") fail();
  return {
    schemaVersion: 1,
    decisionType: "first_publication_metadata_selection",
    authority: "preview_only",
    target: {
      package: "@lervo/cli",
      description: cliEnglishDescription,
      repository: validatedRepository,
      license: validateLicense(license),
      scopeOwner: { kind: scopeOwnerKind, name: scopeOwnerName },
    },
    effect: {
      approval: "not_granted",
      scopeControl: "not_confirmed",
      packageAvailability: "not_observed",
    },
  };
}

export function createFirstPublicationMetadataDecision(input) {
  const body = decisionBody(input ?? {});
  return { ...body, metadataDecisionDigest: canonicalDigest(body) };
}

export function validateFirstPublicationMetadataDecision(decision) {
  let expected;
  try {
    expected = createFirstPublicationMetadataDecision({
      repository: decision?.target?.repository,
      license: decision?.target?.license,
      scopeOwnerKind: decision?.target?.scopeOwner?.kind,
      scopeOwnerName: decision?.target?.scopeOwner?.name,
    });
  } catch {
    fail();
  }
  if (canonicalJson(decision) !== canonicalJson(expected)) fail();
  return decision;
}
