import { isAbsolute, posix, win32 } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { canonicalDigest, canonicalJson } from "./release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_stage_evidence_bundle_invalid",
    "The CLI first-publication stage evidence bundle manifest is invalid.",
  );
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

export function validateFirstPublicationStageEvidenceBundleRelativePath(value) {
  if (
    typeof value !== "string" || value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 512 || value.includes("\0") ||
    value.includes("\\") || isAbsolute(value) || posix.isAbsolute(value) ||
    win32.isAbsolute(value)
  ) fail();
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || [".", ".."].includes(segment))) {
    fail();
  }
  return value;
}

function fileReference(value) {
  return exactKeys(value, ["path", "digest"]) &&
    validateFirstPublicationStageEvidenceBundleRelativePath(value.path) &&
    digestPattern.test(value.digest ?? "");
}

function resultReference(value) {
  return exactKeys(value, ["directory", "attemptDigest", "terminalDigest"]) &&
    validateFirstPublicationStageEvidenceBundleRelativePath(value.directory) &&
    digestPattern.test(value.attemptDigest ?? "") &&
    digestPattern.test(value.terminalDigest ?? "");
}

function body(bundle) {
  return {
    schemaVersion: bundle.schemaVersion,
    manifestType: bundle.manifestType,
    pathBase: bundle.pathBase,
    sourceOwnership: bundle.sourceOwnership,
    sources: bundle.sources,
  };
}

export function createFirstPublicationStageEvidenceBundle({ paths, evidenceSet }) {
  const value = {
    schemaVersion: 1,
    manifestType: "first_publication_stage_evidence_bundle",
    pathBase: "manifest_directory",
    sourceOwnership: "referenced_primary_documents",
    sources: {
      stageReviewReport: {
        path: validateFirstPublicationStageEvidenceBundleRelativePath(
          paths.stageReviewReport,
        ),
        digest: evidenceSet.stageReviewReport.evidenceDigest,
      },
      decision: {
        path: validateFirstPublicationStageEvidenceBundleRelativePath(paths.decision),
        digest: evidenceSet.decision.decisionDigest,
      },
      authorization: {
        path: validateFirstPublicationStageEvidenceBundleRelativePath(paths.authorization),
        digest: evidenceSet.authorization.authorizationDigest,
      },
      approvalResult: {
        directory: validateFirstPublicationStageEvidenceBundleRelativePath(
          paths.resultDirectory,
        ),
        attemptDigest: evidenceSet.attempt.attemptDigest,
        terminalDigest: evidenceSet.terminal.terminalDigest,
      },
      reconciliationReport: {
        path: validateFirstPublicationStageEvidenceBundleRelativePath(
          paths.reconciliationReport,
        ),
        digest: evidenceSet.reconciliationReport.evidenceDigest,
      },
    },
  };
  return validateFirstPublicationStageEvidenceBundleDocument({
    ...value,
    bundleDigest: canonicalDigest(value),
  });
}

export function validateFirstPublicationStageEvidenceBundleDocument(bundle) {
  const value = body(bundle ?? {});
  const sources = bundle?.sources;
  if (
    !exactKeys(bundle, [...Object.keys(value), "bundleDigest"]) ||
    bundle.schemaVersion !== 1 ||
    bundle.manifestType !== "first_publication_stage_evidence_bundle" ||
    bundle.pathBase !== "manifest_directory" ||
    bundle.sourceOwnership !== "referenced_primary_documents" ||
    !exactKeys(sources, [
      "stageReviewReport", "decision", "authorization", "approvalResult",
      "reconciliationReport",
    ]) || !fileReference(sources.stageReviewReport) ||
    !fileReference(sources.decision) || !fileReference(sources.authorization) ||
    !resultReference(sources.approvalResult) ||
    !fileReference(sources.reconciliationReport) ||
    !digestPattern.test(bundle.bundleDigest ?? "") ||
    bundle.bundleDigest !== canonicalDigest(value)
  ) fail();
  return bundle;
}
