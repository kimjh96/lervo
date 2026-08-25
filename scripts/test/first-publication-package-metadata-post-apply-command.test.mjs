import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { verifyCliFirstPublicationPackageMetadataPostApply } from "../lib/cli-first-publication-package-metadata-post-apply.mjs";
import { parseFirstPublicationPackageMetadataPostApplyArguments } from "../lib/first-publication-package-metadata-post-apply-cli-arguments.mjs";
import { formatFirstPublicationPackageMetadataPostApplyReport } from "../lib/first-publication-package-metadata-post-apply-formatter.mjs";
import {
  applyMetadataFixture,
  createMetadataApplyFixture,
} from "./fixtures/first-publication-metadata-apply.mjs";

describe("first-publication package metadata post-apply command", () => {
  it("requires one absolute receipt and rejects online mode", () => {
    assert.deepEqual(
      parseFirstPublicationPackageMetadataPostApplyArguments([
        "--receipt",
        "/tmp/receipt.json",
        "--json",
      ]),
      { receiptPath: "/tmp/receipt.json", json: true },
    );
    for (const args of [
      [],
      ["--receipt", "relative.json"],
      ["--receipt", "/tmp/a", "--receipt", "/tmp/b"],
      ["--receipt", "/tmp/a", "--online"],
      ["--receipt", "/tmp/a", "--json", "--json"],
    ]) {
      assert.throws(() => parseFirstPublicationPackageMetadataPostApplyArguments(args), {
        code: "first_publication_package_metadata_post_apply_arguments_invalid",
      });
    }
  });

  it("verifies applied sources without changing source files", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const applied = await applyMetadataFixture(fixture);
      const paths = [
        fixture.paths.packageManifestPath,
        fixture.paths.releaseManifestPath,
        fixture.paths.releaseSbomPath,
        fixture.paths.lockfilePath,
        applied.receiptPath,
      ];
      const before = await Promise.all(paths.map((path) => readFile(path)));
      const report = await verifyCliFirstPublicationPackageMetadataPostApply(
        applied.receiptPath,
        fixture.paths,
        {
          transactionRoot: fixture.transactionRoot,
          generateRelease: async () => fixture.derivedRelease.releaseManifest,
        },
      );
      assert.equal(report.status, "verified");
      assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("blocks pending recovery state before reading sources", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await mkdir(fixture.transactionRoot);
      let reads = 0;
      await assert.rejects(
        verifyCliFirstPublicationPackageMetadataPostApply(
          "/tmp/unused-receipt.json",
          fixture.paths,
          {
            transactionRoot: fixture.transactionRoot,
            readSources: async () => {
              reads += 1;
              throw new Error("must not read");
            },
          },
        ),
        { code: "first_publication_package_metadata_post_apply_transaction_pending" },
      );
      assert.equal(reads, 0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a source change during release reproduction", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const applied = await applyMetadataFixture(fixture);
      await assert.rejects(
        verifyCliFirstPublicationPackageMetadataPostApply(applied.receiptPath, fixture.paths, {
          transactionRoot: fixture.transactionRoot,
          generateRelease: async () => {
            await writeFile(fixture.paths.lockfilePath, "lockfileVersion: 'changed'\n");
            return fixture.derivedRelease.releaseManifest;
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects recovery state created during verification", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const applied = await applyMetadataFixture(fixture);
      await assert.rejects(
        verifyCliFirstPublicationPackageMetadataPostApply(applied.receiptPath, fixture.paths, {
          transactionRoot: fixture.transactionRoot,
          generateRelease: async () => {
            await mkdir(fixture.transactionRoot);
            return fixture.derivedRelease.releaseManifest;
          },
        }),
        { code: "first_publication_package_metadata_post_apply_transaction_pending" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("explains verified and remaining work without exposing digests", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const applied = await applyMetadataFixture(fixture);
      const report = await verifyCliFirstPublicationPackageMetadataPostApply(
        applied.receiptPath,
        fixture.paths,
        {
          transactionRoot: fixture.transactionRoot,
          generateRelease: async () => fixture.derivedRelease.releaseManifest,
        },
      );
      const output = formatFirstPublicationPackageMetadataPostApplyReport(report);
      assert.match(output, /All local metadata blockers are resolved/u);
      assert.match(output, /still require separate confirmation or approval/u);
      assert.match(output, /receipt signature and issuer were not verified/u);
      assert.equal(output.includes(report.reportDigest), false);
      assert.equal(output.includes(report.receipt.receiptDigest), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
