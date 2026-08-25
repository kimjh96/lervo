import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createFirstPublicationActivationBlockerReport,
  validateFirstPublicationActivationBlockerReport,
} from "../lib/first-publication-activation-blockers.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import { npmPublicRegistry } from "../lib/release-publication-authorization.mjs";
import {
  activationRepository,
  currentActivationSources,
  replaceActivationReleaseArtifact,
} from "./fixtures/first-publication-activation.mjs";

describe("first-publication activation blocker report", () => {
  it("separates current local blockers from external requirements", async () => {
    const report = createFirstPublicationActivationBlockerReport(await currentActivationSources());
    assert.equal(report.status, "blocked");
    assert.equal(report.activation, "not_implemented");
    assert.equal(report.localStatus, "blocked");
    assert.deepEqual(
      report.localChecks.map(({ id, status }) => ({ id, status })),
      [
        { id: "package_identity", status: "ready" },
        { id: "repository_metadata", status: "blocked" },
        { id: "license_metadata", status: "blocked" },
        { id: "publication_metadata", status: "blocked" },
      ],
    );
    assert.deepEqual(
      report.externalRequirements.map(({ id, status }) => ({ id, status })),
      [
        { id: "public_package_availability", status: "required" },
        { id: "npm_scope_control", status: "required" },
        { id: "first_publication_approval", status: "required" },
      ],
    );
    assert.equal(report.sideEffects.metadata, "not_changed");
  });

  it("does not turn locally complete metadata into activation permission", async () => {
    const sources = await currentActivationSources();
    const repositoryUrl = `git+https://github.com/${activationRepository}.git`;
    sources.packageManifest = {
      ...sources.packageManifest,
      license: "Apache-2.0",
      repository: { type: "git", url: repositoryUrl },
      publishConfig: { access: "public", registry: npmPublicRegistry, provenance: true },
    };
    sources.releaseManifest = replaceActivationReleaseArtifact(sources.releaseManifest, {
      license: "Apache-2.0",
      repository: repositoryUrl,
      registry: npmPublicRegistry,
      provenance: true,
    });
    const report = createFirstPublicationActivationBlockerReport(sources);
    assert.equal(report.localStatus, "ready");
    assert.equal(report.status, "blocked");
    assert.equal(report.activation, "not_implemented");
    assert.equal(
      report.externalRequirements.every(({ status }) => status === "required"),
      true,
    );
  });

  it("reports conflicting local metadata instead of choosing one source", async () => {
    const sources = await currentActivationSources();
    const conflictingVersion = sources.packageManifest.version === "9.9.9" ? "8.8.8" : "9.9.9";
    sources.packageManifest = {
      ...sources.packageManifest,
      version: conflictingVersion,
      license: "MIT",
      repository: { type: "git", url: "https://example.invalid/not-git" },
    };
    sources.releaseManifest = replaceActivationReleaseArtifact(sources.releaseManifest, {
      license: "Apache-2.0",
      repository: `git+https://github.com/${activationRepository}.git`,
    });
    const report = createFirstPublicationActivationBlockerReport(sources);
    assert.deepEqual(report.localChecks[0].reasons, ["package_version_mismatch"]);
    assert.deepEqual(report.localChecks[1].reasons, ["package_repository_invalid"]);
    assert.deepEqual(report.localChecks[2].reasons, ["license_mismatch"]);
    assert.equal(report.target.repository, null);
    assert.equal(report.target.license, null);
  });

  it("rejects a redigested claim that activation is ready", async () => {
    const sources = await currentActivationSources();
    const forged = structuredClone(createFirstPublicationActivationBlockerReport(sources));
    forged.status = "ready";
    const { blockerReportDigest: _discarded, ...body } = forged;
    forged.blockerReportDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationActivationBlockerReport(forged, sources), {
      code: "first_publication_activation_blocker_report_invalid",
    });
  });
});
