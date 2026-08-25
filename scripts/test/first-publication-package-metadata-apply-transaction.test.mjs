import assert from "node:assert/strict";
import { access, chmod, lstat, readFile, rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { applyFirstPublicationPackageMetadataFiles } from "../lib/first-publication-package-metadata-apply-filesystem.mjs";
import {
  createFirstPublicationPackageMetadataApplyReceipt,
  validateFirstPublicationPackageMetadataApplyPlan,
  validateFirstPublicationPackageMetadataApplyReceipt,
} from "../lib/first-publication-package-metadata-apply-transaction.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  applyFilesystemInput,
  createMetadataApplyFixture,
} from "./fixtures/first-publication-metadata-apply.mjs";

async function missing(path) {
  await assert.rejects(access(path));
}

async function beforeBytes(fixture) {
  return Promise.all([
    readFile(fixture.paths.packageManifestPath),
    readFile(fixture.paths.releaseManifestPath),
    readFile(fixture.paths.releaseSbomPath),
  ]);
}

async function outputBytes(fixture) {
  return Promise.all([
    readFile(fixture.paths.packageManifestPath),
    readFile(fixture.paths.releaseManifestPath),
    readFile(fixture.paths.releaseSbomPath),
  ]);
}

describe("first-publication package metadata apply transaction", () => {
  it("binds all source and output files in a deterministic apply plan and receipt", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      assert.equal(fixture.planResult.plan.status, "ready_to_apply");
      assert.deepEqual(
        fixture.planResult.plan.files.map(({ id }) => id),
        ["packageManifest", "releaseManifest", "releaseSbom"],
      );
      assert.deepEqual(
        fixture.planResult.plan.readOnlySources.map(({ id }) => id),
        ["lockfile", "permit"],
      );
      assert.equal(fixture.planResult.plan.strategy.synchronousFailure, "rollback_all_files");
      const receipt = createFirstPublicationPackageMetadataApplyReceipt(fixture.planResult.plan);
      assert.equal(receipt.status, "applied");
      assert.equal(receipt.effects.releaseManifest, "regenerated");
      assert.equal(receipt.effects.releaseSbom, "regenerated");
      assert.equal(
        validateFirstPublicationPackageMetadataApplyReceipt(receipt, fixture.planResult.plan),
        receipt,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a redigested plan that weakens compare-and-swap", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const forged = structuredClone(fixture.planResult);
      forged.outputBytes = Object.fromEntries(
        Object.entries(fixture.planResult.outputBytes).map(([id, contents]) => [
          id,
          Buffer.from(contents),
        ]),
      );
      forged.plan.strategy.compareAndSwap = "package_only";
      const { planDigest: _discarded, ...body } = forged.plan;
      forged.plan.planDigest = canonicalDigest(body);
      assert.throws(
        () => validateFirstPublicationPackageMetadataApplyPlan(forged, fixture.planInput),
        { code: "first_publication_package_metadata_apply_plan_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("publishes all three outputs and removes its journal", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const result = await applyFirstPublicationPackageMetadataFiles(applyFilesystemInput(fixture));
      assert.deepEqual(result, {
        journal: "removed",
        rollback: "not_required",
        recovery: "not_required",
      });
      assert.deepEqual(await outputBytes(fixture), [
        fixture.planResult.outputBytes.packageManifest,
        fixture.planResult.outputBytes.releaseManifest,
        fixture.planResult.outputBytes.releaseSbom,
      ]);
      await missing(fixture.transactionRoot);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("preserves each target file mode", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await chmod(fixture.paths.packageManifestPath, 0o640);
      const beforeModes = await Promise.all(
        Object.values(fixture.targets).map(async (path) => (await lstat(path)).mode & 0o777),
      );
      await applyFirstPublicationPackageMetadataFiles(applyFilesystemInput(fixture));
      const afterModes = await Promise.all(
        Object.values(fixture.targets).map(async (path) => (await lstat(path)).mode & 0o777),
      );
      assert.deepEqual(afterModes, beforeModes);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("restores every file after each synchronous publication failure", async () => {
    const checkpoints = [
      "staged",
      "original_moved:0",
      "published:0",
      "original_moved:1",
      "published:1",
      "original_moved:2",
      "published:2",
    ];
    for (const checkpoint of checkpoints) {
      const fixture = await createMetadataApplyFixture();
      try {
        const before = await beforeBytes(fixture);
        await assert.rejects(
          applyFirstPublicationPackageMetadataFiles(applyFilesystemInput(fixture), {
            failureInjector: (current) => {
              if (current === checkpoint) throw new Error(`fail:${checkpoint}`);
            },
          }),
          { code: "first_publication_package_metadata_apply_failed" },
        );
        assert.deepEqual(await beforeBytes(fixture), before);
        await missing(fixture.transactionRoot);
      } finally {
        await rm(fixture.root, { recursive: true, force: true });
      }
    }
  });

  it("rejects a stale source before creating transaction state", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await writeFile(fixture.paths.packageManifestPath, "{}\n");
      await assert.rejects(
        applyFirstPublicationPackageMetadataFiles(applyFilesystemInput(fixture)),
        { code: "first_publication_package_metadata_apply_source_changed" },
      );
      await missing(fixture.transactionRoot);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
