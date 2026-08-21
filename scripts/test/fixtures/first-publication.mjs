import { createFirstPublicationBootstrapAuthorization } from
  "../../lib/first-publication-bootstrap.mjs";
import {
  createReleasePublicationArtifact,
  createReleasePublicationAuthorization,
  npmPublicRegistry,
} from "../../lib/release-publication-authorization.mjs";

export const firstPublicationRepository = "lervo-dev/lervo";

export function createFirstPublicationFixture({
  tarballContents = Buffer.from("first-publication-fixture-tarball"),
  approvalId = "apr_fixture1",
  version = "0.1.0",
} = {}) {
  const artifact = createReleasePublicationArtifact(
    `lervo-cli-${version}.tgz`,
    version,
    tarballContents,
  );
  const publicationAuthorization = createReleasePublicationAuthorization({
    verification: {
      schemaVersion: 1,
      status: "verified",
      repository: firstPublicationRepository,
      workflow: ".github/workflows/cli-release-matrix.yml",
      tag: `v${version}`,
      sourceDigest: "a".repeat(40),
      subjects: [
        { name: artifact.file, digest: { sha256: artifact.sha256 } },
        { name: "release-artifact-manifest.json", digest: { sha256: "b".repeat(64) } },
        { name: "release-sbom.cdx.json", digest: { sha256: "c".repeat(64) } },
      ],
    },
    version,
    distTag: "latest",
    artifact,
  });
  const bootstrap = createFirstPublicationBootstrapAuthorization({
    publicationAuthorization,
    packageManifest: {
      name: "@lervo/cli",
      version,
      license: "Apache-2.0",
      private: false,
      repository: {
        type: "git",
        url: `git+https://github.com/${firstPublicationRepository}.git`,
      },
      publishConfig: { access: "public", registry: npmPublicRegistry, provenance: true },
    },
    releaseManifest: {
      artifact: {
        name: "@lervo/cli",
        version,
        license: "Apache-2.0",
        repository: `git+https://github.com/${firstPublicationRepository}.git`,
        registry: npmPublicRegistry,
        provenance: true,
        private: false,
        access: "public",
      },
    },
    approval: {
      schemaVersion: 1,
      approvalId,
      decision: "approve_first_publication",
      approvedAt: "2026-08-21T02:55:00Z",
      expiresAt: "2026-08-21T04:00:00Z",
      approver: { kind: "user", id: "release-owner@example.invalid" },
      target: {
        package: "@lervo/cli",
        repository: firstPublicationRepository,
        license: "Apache-2.0",
        scopeOwner: { kind: "organization", name: "lervo" },
        publicationAuthorizationDigest: publicationAuthorization.authorizationDigest,
      },
      confirmations: [
        "license_approved",
        "one_time_direct_publish_approved",
        "package_name_availability_confirmed",
        "scope_control_confirmed",
        "stage_only_transition_required",
      ],
    },
    packageObservation: {
      schemaVersion: 1,
      source: "npm_public_registry",
      state: "not_found",
      package: "@lervo/cli",
    },
    observedAt: "2026-08-21T03:00:00Z",
  });
  return { artifact, bootstrap, publicationAuthorization, tarballContents };
}
