import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

const sha1Pattern = /^[a-f0-9]{40}$/u;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_public_release_observation_invalid",
    "The CLI first-publication public-release observation is invalid.",
  );
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function validateObservation(observation, target) {
  if (
    observation?.schemaVersion !== 1 ||
    observation.source !== "npm_public_registry_reconciliation" ||
    observation.package !== target.package ||
    observation.version !== target.version ||
    observation.distTag !== target.distTag
  )
    fail();
  if (observation.state === "unavailable") {
    if (
      !exactKeys(observation, [
        "schemaVersion",
        "source",
        "state",
        "package",
        "version",
        "distTag",
        "reason",
      ]) ||
      observation.reason !== "registry_unavailable"
    )
      fail();
    return observation;
  }
  if (
    observation.state !== "observed" ||
    !exactKeys(observation, [
      "schemaVersion",
      "source",
      "state",
      "package",
      "version",
      "distTag",
      "versionMetadata",
      "distTagValue",
    ]) ||
    !exactKeys(
      observation.versionMetadata,
      observation.versionMetadata?.state === "found"
        ? ["state", "registryIntegrity", "registryShasum"]
        : ["state"],
    ) ||
    !["found", "not_found"].includes(observation.versionMetadata.state) ||
    !exactKeys(
      observation.distTagValue,
      observation.distTagValue?.state === "found" ? ["state", "version"] : ["state"],
    ) ||
    !["found", "not_found"].includes(observation.distTagValue.state)
  )
    fail();
  if (
    observation.versionMetadata.state === "found" &&
    (!sha512IntegrityPattern.test(observation.versionMetadata.registryIntegrity ?? "") ||
      !sha1Pattern.test(observation.versionMetadata.registryShasum ?? ""))
  )
    fail();
  if (
    observation.distTagValue.state === "found" &&
    (typeof observation.distTagValue.version !== "string" ||
      observation.distTagValue.version.length < 1 ||
      observation.distTagValue.version.length > 128 ||
      /[\p{Cc}\p{Cf}]/u.test(observation.distTagValue.version))
  )
    fail();
  return observation;
}

function check(id, status, reasons = []) {
  return { id, status, reasons };
}

function checks(observation, artifact, target) {
  if (observation.state === "unavailable") {
    return [
      check("exact_version", "unknown", ["registry_unavailable"]),
      check("target_dist_tag", "unknown", ["registry_unavailable"]),
    ];
  }
  const version = observation.versionMetadata;
  const versionMatches =
    version.state === "found" &&
    version.registryIntegrity === artifact.registryIntegrity &&
    version.registryShasum === artifact.registryShasum;
  const versionCheck =
    version.state === "not_found"
      ? check("exact_version", "not_observed", ["target_version_not_observed"])
      : versionMatches
        ? check("exact_version", "matched")
        : check("exact_version", "unknown", ["exact_release_mismatch"]);
  const tagMatches =
    observation.distTagValue.state === "found" &&
    observation.distTagValue.version === target.version;
  const tagCheck = tagMatches
    ? check("target_dist_tag", "matched")
    : check("target_dist_tag", "not_observed", ["target_dist_tag_not_observed"]);
  return [versionCheck, tagCheck];
}

function outcome(foundChecks) {
  if (foundChecks.every(({ status }) => status === "matched")) return "published";
  if (foundChecks[0].status === "not_observed" && foundChecks[1].status === "not_observed")
    return "not_observed";
  return "unknown";
}

export function inspectFirstPublicationPublicRelease({ observation, target, artifact }) {
  validateObservation(observation, target);
  const foundChecks = checks(observation, artifact, target);
  return { outcome: outcome(foundChecks), checks: foundChecks };
}
