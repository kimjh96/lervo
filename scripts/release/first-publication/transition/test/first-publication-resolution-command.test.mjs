import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import {
  resolveCliFirstPublication,
  writeFirstPublicationResolution,
} from "../cli-first-publication-resolution.mjs";
import { createFileFirstPublicationReservationStore } from "../../adapters/file-first-publication-reservation-store.mjs";
import { createFirstPublicationReconciliationReport } from "../first-publication-reconciliation.mjs";
import { createFirstPublicationReservation } from "../../shared/first-publication-reservation.mjs";
import { firstPublicationResolutionConfirmations } from "../first-publication-resolution-decision.mjs";
import { canonicalDigest } from "../../../../shared/release-artifact-manifest.mjs";
import { createFirstPublicationFixture } from "../../test/fixtures/first-publication.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../../..");

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

async function commandFixture({ canonical = true } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-resolution-"));
  const source = createFirstPublicationFixture({ armingDecisionId: "arm_resolve_command1" });
  const reservationRoot = resolve(root, "reservations");
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
  const reconciliationReport = createFirstPublicationReconciliationReport({
    ...source,
    reservation,
    terminal,
    npmObservation: matchingObservation(source),
    observedAt: "2026-08-21T03:02:00Z",
  });
  const decision = {
    schemaVersion: 1,
    decisionId: "res_command1",
    decision: "authorize_reconciled_publication_transition_review",
    decidedAt: "2026-08-21T03:02:30Z",
    expiresAt: "2026-08-21T03:10:00Z",
    actor: { kind: "user", id: "release-reviewer@example.invalid" },
    target: {
      package: source.bootstrap.target.package,
      version: source.bootstrap.target.version,
      bootstrapDigest: source.bootstrap.bootstrapDigest,
      reservationDigest: reservation.reservationDigest,
      terminalRecordDigest: canonicalDigest(terminal),
      reconciliationReportDigest: reconciliationReport.reconciliationReportDigest,
    },
    confirmations: [...firstPublicationResolutionConfirmations],
  };
  const paths = {
    publicationAuthorizationPath: resolve(root, "publication.json"),
    bootstrapPath: resolve(root, "bootstrap.json"),
    armingAuthorizationPath: resolve(root, "arming.json"),
    reconciliationReportPath: resolve(root, "reconciliation.json"),
    decisionPath: resolve(root, "decision.json"),
  };
  const serialize = (value) =>
    canonical ? `${JSON.stringify(value, null, 2)}\n` : `${JSON.stringify(value)}\n`;
  await Promise.all([
    writeFile(
      paths.publicationAuthorizationPath,
      `${JSON.stringify(source.publicationAuthorization)}\n`,
    ),
    writeFile(paths.bootstrapPath, `${JSON.stringify(source.bootstrap)}\n`),
    writeFile(paths.armingAuthorizationPath, `${JSON.stringify(source.armingAuthorization)}\n`),
    writeFile(paths.reconciliationReportPath, serialize(reconciliationReport)),
    writeFile(paths.decisionPath, serialize(decision)),
  ]);
  const store = createFileFirstPublicationReservationStore({ rootDirectory: reservationRoot });
  await store.reserve(reservation);
  await store.markUnknown(terminal);
  return {
    root,
    source,
    reservation,
    terminal,
    store,
    paths,
    options: { online: true, reservationRoot, ...paths },
  };
}

describe("first-publication resolution command orchestration", () => {
  it("creates one immutable resolution while preserving unknown storage", async () => {
    const prepared = await commandFixture();
    try {
      const before = await prepared.store.inspect(prepared.reservation.reservationId);
      const directory = resolve(
        prepared.options.reservationRoot,
        prepared.reservation.reservationId,
      );
      const namesBefore = await readdir(directory);
      const resolution = await resolveCliFirstPublication(prepared.options, {
        observe: async () => matchingObservation(prepared.source),
        clock: () => "2026-08-21T03:03:00Z",
      });
      const outputPath = resolve(prepared.root, "resolution.json");
      await writeFirstPublicationResolution(outputPath, resolution);
      assert.equal(
        JSON.parse(await readFile(outputPath, "utf8")).status,
        "transition_review_eligible",
      );
      await assert.rejects(writeFirstPublicationResolution(outputPath, resolution), {
        code: "first_publication_resolution_output_exists",
      });
      assert.deepEqual(await prepared.store.inspect(prepared.reservation.reservationId), before);
      assert.deepEqual(await readdir(directory), namesBefore);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("refuses a fresh not-observed result", async () => {
    const prepared = await commandFixture();
    try {
      const missing = {
        ...matchingObservation(prepared.source),
        versionMetadata: { state: "not_found" },
        distTagValue: { state: "not_found" },
      };
      await assert.rejects(
        resolveCliFirstPublication(prepared.options, {
          observe: async () => missing,
          clock: () => "2026-08-21T03:03:00Z",
        }),
        { code: "first_publication_resolution_fresh_observation_required" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects a reviewed source changed during fresh observation", async () => {
    const prepared = await commandFixture();
    try {
      await assert.rejects(
        resolveCliFirstPublication(prepared.options, {
          observe: async () => {
            await writeFile(prepared.paths.decisionPath, "{}\n");
            return matchingObservation(prepared.source);
          },
          clock: () => "2026-08-21T03:03:00Z",
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("requires canonical reviewed report and decision files", async () => {
    const prepared = await commandFixture({ canonical: false });
    try {
      await assert.rejects(
        resolveCliFirstPublication(prepared.options, {
          observe: async () => assert.fail("observer must not run"),
        }),
        { code: "first_publication_resolution_source_invalid" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects a decision bound to another report before online observation", async () => {
    const prepared = await commandFixture();
    try {
      const decision = JSON.parse(await readFile(prepared.paths.decisionPath, "utf8"));
      decision.target.reconciliationReportDigest = `sha256:${"a".repeat(64)}`;
      await writeFile(prepared.paths.decisionPath, `${JSON.stringify(decision, null, 2)}\n`);
      await assert.rejects(
        resolveCliFirstPublication(prepared.options, {
          observe: async () => assert.fail("observer must not run"),
        }),
        { code: "first_publication_resolution_decision_invalid" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("requires online before reading sources", async () => {
    let reads = 0;
    await assert.rejects(
      resolveCliFirstPublication(
        {
          online: false,
          publicationAuthorizationPath: "/publication.json",
          bootstrapPath: "/bootstrap.json",
          armingAuthorizationPath: "/arming.json",
          reservationRoot: "/reservations",
          reconciliationReportPath: "/report.json",
          decisionPath: "/decision.json",
        },
        {
          readSources: async () => {
            reads += 1;
          },
        },
      ),
      {
        code: "first_publication_resolution_online_required",
      },
    );
    assert.equal(reads, 0);
  });

  it("rejects incomplete, duplicate, unknown, and offline executable arguments", () => {
    const base = [
      "--publication-authorization",
      "/publication.json",
      "--bootstrap",
      "/bootstrap.json",
      "--arming-authorization",
      "/arming.json",
      "--reservation-root",
      "/reservations",
      "--reconciliation-report",
      "/report.json",
      "--decision",
      "/decision.json",
      "--output",
      "/resolution.json",
    ];
    for (const args of [
      base,
      [...base, "--online", "--online"],
      [...base, "--online", "--unknown"],
      [...base.slice(0, -2), "--online"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/release/first-publication/transition/commands/resolve-cli-first-publication-reconciliation.mjs",
          ...args,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_resolution_arguments_invalid:/u);
    }
  });
});
