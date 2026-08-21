import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createFileFirstPublicationReservationStore } from
  "../lib/file-first-publication-reservation-store.mjs";
import { observeFirstPublicationArtifact } from
  "../lib/first-publication-artifact-observer.mjs";
import { createFirstPublicationBootstrapAuthorization } from
  "../lib/first-publication-bootstrap.mjs";
import {
  createFirstPublicationPreflightReport,
  validateFirstPublicationPreflightReport,
} from "../lib/first-publication-preflight.mjs";
import { inspectFirstPublicationPreflight } from
  "../lib/first-publication-preflight-inspector.mjs";
import {
  createFirstPublicationReservation,
  firstPublicationReservationId,
} from "../lib/first-publication-reservation.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import { createNpmInteractiveFirstPublicationObservation } from
  "../lib/npm-interactive-first-publication-policy.mjs";
import {
  createReleasePublicationArtifact,
  createReleasePublicationAuthorization,
  npmPublicRegistry,
} from "../lib/release-publication-authorization.mjs";

const repository = "lervo-dev/lervo";
const tarball = Buffer.from("first-publication-preflight-tarball");

function fixture() {
  const version = "0.1.0";
  const artifact = createReleasePublicationArtifact(
    `lervo-cli-${version}.tgz`,
    version,
    tarball,
  );
  const publicationAuthorization = createReleasePublicationAuthorization({
    verification: {
      schemaVersion: 1,
      status: "verified",
      repository,
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
      repository: { type: "git", url: `git+https://github.com/${repository}.git` },
      publishConfig: { access: "public", registry: npmPublicRegistry, provenance: true },
    },
    releaseManifest: {
      artifact: {
        name: "@lervo/cli",
        version,
        license: "Apache-2.0",
        repository: `git+https://github.com/${repository}.git`,
        registry: npmPublicRegistry,
        provenance: true,
        private: false,
        access: "public",
      },
    },
    approval: {
      schemaVersion: 1,
      approvalId: "apr_preflight1",
      decision: "approve_first_publication",
      approvedAt: "2026-08-21T02:55:00Z",
      expiresAt: "2026-08-21T04:00:00Z",
      approver: { kind: "user", id: "release-owner@example.invalid" },
      target: {
        package: "@lervo/cli",
        repository,
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
  return { artifact, bootstrap, publicationAuthorization };
}

function readyNpm(overrides = {}) {
  return createNpmInteractiveFirstPublicationObservation({
    npmVersion: "11.17.0",
    profile: { tfa: { mode: "auth-and-writes", pending: false } },
    environment: {},
    stdinIsTTY: true,
    stdoutIsTTY: true,
    stderrIsTTY: true,
    ...overrides,
  });
}

function reportInput(source, overrides = {}) {
  return {
    bootstrap: source.bootstrap,
    publicationAuthorization: source.publicationAuthorization,
    artifactObservation: {
      schemaVersion: 1,
      source: "first_publication_artifact",
      state: "verified",
      artifactSha256: source.artifact.sha256,
    },
    packageObservation: {
      schemaVersion: 1,
      source: "npm_public_registry",
      state: "not_found",
      package: "@lervo/cli",
    },
    reservationObservation: {
      schemaVersion: 1,
      source: "first_publication_reservation_store",
      state: "missing",
      reservationId: firstPublicationReservationId(source.bootstrap),
    },
    npmObservation: readyNpm(),
    checkedAt: "2026-08-21T03:01:00Z",
    ...overrides,
  };
}

describe("first-publication preflight report", () => {
  it("reports exact ready evidence without claiming or causing execution", () => {
    const input = reportInput(fixture());
    const report = createFirstPublicationPreflightReport(input);
    assert.equal(report.status, "ready");
    assert.equal(report.advisoryOnly, true);
    assert.deepEqual(report.checks.map(({ status }) => status), Array(5).fill("ready"));
    assert.deepEqual(report.sideEffects, {
      reservation: "not_created",
      publication: "not_attempted",
      externalSettings: "not_changed",
    });
    assert.equal(validateFirstPublicationPreflightReport(report, input), report);
  });

  it("fails closed for expired, existing, unavailable, and reserved evidence", () => {
    const source = fixture();
    const reservation = createFirstPublicationReservation(
      source.bootstrap,
      "2026-08-21T03:01:00Z",
    );
    const report = createFirstPublicationPreflightReport(reportInput(source, {
      checkedAt: "2026-08-21T03:10:00Z",
      packageObservation: {
        schemaVersion: 1,
        source: "npm_public_registry",
        state: "unavailable",
        package: "@lervo/cli",
        reason: "registry_unavailable",
      },
      reservationObservation: {
        schemaVersion: 1,
        source: "first_publication_reservation_store",
        state: "reserved",
        reservationId: reservation.reservationId,
        bootstrapDigest: reservation.bootstrapDigest,
        reservationDigest: reservation.reservationDigest,
      },
      npmObservation: readyNpm({ stdinIsTTY: false }),
    }));
    assert.equal(report.status, "blocked");
    assert.deepEqual(report.checks.map(({ status }) => status), [
      "blocked", "ready", "unknown", "blocked", "blocked",
    ]);
    assert.deepEqual(report.checks[4].reasons, ["terminal_not_interactive"]);
  });

  it("rejects a redigested semantic lie instead of trusting the digest", () => {
    const input = reportInput(fixture());
    const report = createFirstPublicationPreflightReport(input);
    report.checks[0].status = "blocked";
    report.checks[0].reasons = ["bootstrap_expired"];
    report.status = "blocked";
    const body = structuredClone(report);
    delete body.preflightDigest;
    report.preflightDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationPreflightReport(report, input), {
      code: "first_publication_preflight_invalid",
    });
  });

  it("does not expose npm profile, environment names, token, or OTP values", () => {
    const observation = createNpmInteractiveFirstPublicationObservation({
      npmVersion: "11.17.0",
      profile: { name: "owner", tfa: { mode: "auth-only", pending: false } },
      environment: { NPM_CONFIG_OTP: "secret-otp", NPM_TOKEN: "secret-token" },
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });
    assert.deepEqual(observation.reasons, [
      "registry_credential_in_environment",
      "npm_write_2fa_not_ready",
    ]);
    const serialized = JSON.stringify(observation);
    assert.equal(serialized.includes("owner"), false);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(serialized.includes("NPM_"), false);
  });
});

describe("first-publication read-only observations", () => {
  it("combines read ports without reserving or publishing", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-preflight-inspector-"));
    try {
      const source = fixture();
      await writeFile(resolve(root, source.artifact.file), tarball);
      let writes = 0;
      const result = await inspectFirstPublicationPreflight({
        bootstrap: source.bootstrap,
        publicationAuthorization: source.publicationAuthorization,
        releaseDirectory: root,
      }, {
        reservationStore: {
          observe: async (reservationId) => ({
            schemaVersion: 1,
            source: "first_publication_reservation_store",
            state: "missing",
            reservationId,
          }),
          reserve: async () => { writes += 1; },
        },
        observePackage: async () => ({
          schemaVersion: 1,
          source: "npm_public_registry",
          state: "not_found",
          package: "@lervo/cli",
        }),
        observeNpm: async () => readyNpm(),
        clock: () => "2026-08-21T03:01:00Z",
      });
      assert.equal(result.report.status, "ready");
      assert.equal(writes, 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("turns an unreadable reservation store into unknown instead of missing", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-preflight-inspector-"));
    try {
      const source = fixture();
      await writeFile(resolve(root, source.artifact.file), tarball);
      const result = await inspectFirstPublicationPreflight({
        bootstrap: source.bootstrap,
        publicationAuthorization: source.publicationAuthorization,
        releaseDirectory: root,
      }, {
        reservationStore: { observe: async () => { throw new Error("private path"); } },
        observePackage: async () => ({
          schemaVersion: 1,
          source: "npm_public_registry",
          state: "not_found",
          package: "@lervo/cli",
        }),
        observeNpm: async () => readyNpm(),
        clock: () => "2026-08-21T03:01:00Z",
      });
      assert.equal(result.report.status, "blocked");
      assert.deepEqual(result.report.checks[3], {
        id: "reservation_state",
        status: "unknown",
        reasons: ["reservation_store_unavailable"],
      });
      assert.equal(JSON.stringify(result).includes("private path"), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("observes a missing reservation without creating the store root", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-preflight-store-"));
    const stateRoot = resolve(root, "reservations");
    try {
      const source = fixture();
      const store = createFileFirstPublicationReservationStore({ rootDirectory: stateRoot });
      assert.equal((await store.observe(firstPublicationReservationId(source.bootstrap))).state, "missing");
      await assert.rejects(lstat(stateRoot), { code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed on a partial reservation instead of reporting it missing", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-preflight-store-"));
    try {
      const source = fixture();
      const reservationId = firstPublicationReservationId(source.bootstrap);
      await mkdir(resolve(root, reservationId), { mode: 0o700 });
      const store = createFileFirstPublicationReservationStore({ rootDirectory: root });
      await assert.rejects(store.observe(reservationId), { code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects artifact changes using only bounded file reads", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-preflight-artifact-"));
    try {
      const source = fixture();
      const path = resolve(root, source.artifact.file);
      await writeFile(path, tarball);
      assert.equal((await observeFirstPublicationArtifact({
        publicationAuthorization: source.publicationAuthorization,
        releaseDirectory: root,
      })).state, "verified");
      await writeFile(path, Buffer.from("changed"));
      assert.equal((await observeFirstPublicationArtifact({
        publicationAuthorization: source.publicationAuthorization,
        releaseDirectory: root,
      })).state, "changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
