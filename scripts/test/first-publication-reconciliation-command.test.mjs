import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { reconcileCliFirstPublication } from "../lib/cli-first-publication-reconciliation.mjs";
import { createFileFirstPublicationReservationStore } from "../lib/file-first-publication-reservation-store.mjs";
import { formatFirstPublicationReconciliation } from "../lib/first-publication-reconciliation-formatter.mjs";
import { createFirstPublicationReservation } from "../lib/first-publication-reservation.mjs";
import { observeFirstPublicationReconciliation } from "../lib/npm-first-publication-reconciliation-observer.mjs";
import { createFirstPublicationFixture } from "./fixtures/first-publication.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function commandFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-reconciliation-"));
  const source = createFirstPublicationFixture({ armingDecisionId: "arm_reconcile1" });
  const publicationAuthorizationPath = resolve(root, "publication.json");
  const bootstrapPath = resolve(root, "bootstrap.json");
  const armingAuthorizationPath = resolve(root, "arming.json");
  const reservationRoot = resolve(root, "reservations");
  await Promise.all([
    writeFile(publicationAuthorizationPath, `${JSON.stringify(source.publicationAuthorization)}\n`),
    writeFile(bootstrapPath, `${JSON.stringify(source.bootstrap)}\n`),
    writeFile(armingAuthorizationPath, `${JSON.stringify(source.armingAuthorization)}\n`),
  ]);
  const reservation = createFirstPublicationReservation({
    ...source,
    reservedAt: "2026-08-21T03:01:00Z",
  });
  const terminal = {
    reservationId: reservation.reservationId,
    reservationDigest: reservation.reservationDigest,
    state: "publication_unknown",
    retry: "forbidden",
  };
  const store = createFileFirstPublicationReservationStore({ rootDirectory: reservationRoot });
  await store.reserve(reservation);
  await store.markUnknown(terminal);
  return {
    root,
    source,
    reservation,
    terminal,
    store,
    options: {
      online: true,
      publicationAuthorizationPath,
      bootstrapPath,
      armingAuthorizationPath,
      reservationRoot,
    },
  };
}

function matchingObservation(source) {
  return {
    schemaVersion: 1,
    source: "npm_public_registry_reconciliation",
    state: "observed",
    package: source.bootstrap.target.package,
    version: source.bootstrap.target.version,
    distTag: source.bootstrap.target.distTag,
    versionMetadata: {
      state: "found",
      registryIntegrity: source.artifact.registryIntegrity,
      registryShasum: source.artifact.registryShasum,
    },
    distTagValue: { state: "found", version: source.bootstrap.target.version },
  };
}

describe("first-publication reconciliation command orchestration", () => {
  it("reports published while preserving the exact reservation directory", async () => {
    const prepared = await commandFixture();
    try {
      const before = await prepared.store.inspect(prepared.reservation.reservationId);
      const namesBefore = await readdir(
        resolve(prepared.options.reservationRoot, prepared.reservation.reservationId),
      );
      const report = await reconcileCliFirstPublication(prepared.options, {
        observe: async () => matchingObservation(prepared.source),
        clock: () => "2026-08-21T03:10:00Z",
      });
      assert.equal(report.outcome, "published");
      assert.deepEqual(await prepared.store.inspect(prepared.reservation.reservationId), before);
      assert.deepEqual(
        await readdir(
          resolve(prepared.options.reservationRoot, prepared.reservation.reservationId),
        ),
        namesBefore,
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects a contract changed during the online observation", async () => {
    const prepared = await commandFixture();
    try {
      await assert.rejects(
        reconcileCliFirstPublication(prepared.options, {
          observe: async () => {
            await writeFile(prepared.options.armingAuthorizationPath, "{}\n");
            return matchingObservation(prepared.source);
          },
          clock: () => "2026-08-21T03:10:00Z",
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("requires the online boundary before reading any source", async () => {
    let reads = 0;
    await assert.rejects(
      reconcileCliFirstPublication(
        {
          online: false,
          publicationAuthorizationPath: "/publication.json",
          bootstrapPath: "/bootstrap.json",
          armingAuthorizationPath: "/arming.json",
          reservationRoot: "/reservations",
        },
        {
          readSources: async () => {
            reads += 1;
          },
        },
      ),
      {
        code: "first_publication_reconciliation_online_required",
      },
    );
    assert.equal(reads, 0);
  });

  it("does not create a missing reservation root during inspection", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-reconciliation-missing-"));
    const reservationRoot = resolve(root, "missing");
    try {
      const store = createFileFirstPublicationReservationStore({ rootDirectory: reservationRoot });
      await assert.rejects(store.inspect("fpr_aaaaaaaaaaaaaaaaaaaaaaaa"), {
        code: "first_publication_store_missing",
      });
      await assert.rejects(lstat(reservationRoot), { code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("formats a natural no-retry boundary", () => {
    const output = formatFirstPublicationReconciliation({
      outcome: "not_observed",
      checks: [
        { id: "exact_version", status: "not_observed", reasons: ["target_version_not_observed"] },
        {
          id: "target_dist_tag",
          status: "not_observed",
          reasons: ["target_dist_tag_not_observed"],
        },
      ],
    });
    assert.match(output, /not observed/u);
    assert.match(output, /did not retry automatically or mark publication complete/u);
  });

  it("rejects missing online and unknown executable arguments without stdout", () => {
    for (const extra of [[], ["--unexpected"]]) {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/check-cli-first-publication-reconciliation.mjs",
          "--publication-authorization",
          "/publication.json",
          "--bootstrap",
          "/bootstrap.json",
          "--arming-authorization",
          "/arming.json",
          "--reservation-root",
          "/reservations",
          ...extra,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_reconciliation_arguments_invalid:/u);
    }
  });
});

describe("public npm reconciliation observer", () => {
  it("reads only exact version metadata and dist-tags into bounded evidence", async () => {
    const source = createFirstPublicationFixture();
    const urls = [];
    const observation = await observeFirstPublicationReconciliation(source.bootstrap.target, {
      request: async (url) => {
        urls.push(url);
        return new Response(
          JSON.stringify(
            url.includes("dist-tags")
              ? { latest: source.bootstrap.target.version }
              : {
                  name: source.bootstrap.target.package,
                  version: source.bootstrap.target.version,
                  dist: {
                    integrity: source.artifact.registryIntegrity,
                    shasum: source.artifact.registryShasum,
                  },
                },
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    assert.equal(observation.state, "observed");
    assert.equal(observation.versionMetadata.registryIntegrity, source.artifact.registryIntegrity);
    assert.equal(urls.length, 2);
    assert.ok(urls.some((url) => url.endsWith("/0.1.0")));
    assert.ok(urls.some((url) => url.endsWith("/dist-tags")));
  });

  it("normalizes missing coordinates and oversized responses without error text", async () => {
    const source = createFirstPublicationFixture();
    const missing = await observeFirstPublicationReconciliation(source.bootstrap.target, {
      request: async () => new Response(null, { status: 404 }),
    });
    assert.equal(missing.state, "observed");
    assert.equal(missing.versionMetadata.state, "not_found");
    const oversized = await observeFirstPublicationReconciliation(source.bootstrap.target, {
      request: async () =>
        new Response("private response", {
          status: 200,
          headers: { "content-length": String(300 * 1024) },
        }),
    });
    assert.equal(oversized.state, "unavailable");
    assert.equal(JSON.stringify(oversized).includes("private response"), false);
  });
});
