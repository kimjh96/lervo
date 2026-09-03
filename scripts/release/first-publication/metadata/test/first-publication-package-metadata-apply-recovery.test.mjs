import assert from "node:assert/strict";
import { access, readFile, rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { applyFirstPublicationPackageMetadataFiles } from "../first-publication-package-metadata-apply-filesystem.mjs";
import { recoverFirstPublicationPackageMetadataFiles } from "../first-publication-package-metadata-apply-recovery.mjs";
import {
  applyFilesystemInput,
  createMetadataApplyFixture,
} from "../../test/fixtures/first-publication-metadata-apply.mjs";

async function targetBytes(fixture) {
  return Promise.all(Object.values(fixture.targets).map((path) => readFile(path)));
}

describe("first-publication package metadata apply recovery", () => {
  it("distinguishes absent recovery state from a damaged journal", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await assert.rejects(
        recoverFirstPublicationPackageMetadataFiles({
          transactionRoot: fixture.transactionRoot,
          targets: fixture.targets,
        }),
        { code: "first_publication_package_metadata_apply_recovery_not_found" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("restores all originals after a pre-commit interruption", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const before = await targetBytes(fixture);
      await assert.rejects(
        applyFirstPublicationPackageMetadataFiles(applyFilesystemInput(fixture), {
          ownerPid: 2_147_483_647,
          failureInjector: (current) => (current === "published:1" ? "interrupt" : undefined),
        }),
        { code: "first_publication_package_metadata_apply_recovery_required" },
      );
      assert.deepEqual(
        await recoverFirstPublicationPackageMetadataFiles({
          transactionRoot: fixture.transactionRoot,
          targets: fixture.targets,
        }),
        { status: "rolled_back" },
      );
      assert.deepEqual(await targetBytes(fixture), before);
      await assert.rejects(access(fixture.transactionRoot));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps committed outputs when only cleanup was interrupted", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await assert.rejects(
        applyFirstPublicationPackageMetadataFiles(applyFilesystemInput(fixture), {
          ownerPid: 2_147_483_647,
          failureInjector: (current) => (current === "committed" ? "interrupt" : undefined),
        }),
        { code: "first_publication_package_metadata_apply_recovery_required" },
      );
      assert.deepEqual(
        await recoverFirstPublicationPackageMetadataFiles({
          transactionRoot: fixture.transactionRoot,
          targets: fixture.targets,
        }),
        { status: "committed_cleanup_completed" },
      );
      assert.deepEqual(await targetBytes(fixture), [
        fixture.planResult.outputBytes.packageManifest,
        fixture.planResult.outputBytes.releaseManifest,
        fixture.planResult.outputBytes.releaseSbom,
      ]);
      await assert.rejects(access(fixture.transactionRoot));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("refuses to recover a transaction whose owner process is still alive", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await assert.rejects(
        applyFirstPublicationPackageMetadataFiles(applyFilesystemInput(fixture), {
          ownerPid: process.pid,
          failureInjector: (current) => (current === "staged" ? "interrupt" : undefined),
        }),
        { code: "first_publication_package_metadata_apply_recovery_required" },
      );
      await assert.rejects(
        recoverFirstPublicationPackageMetadataFiles({
          transactionRoot: fixture.transactionRoot,
          targets: fixture.targets,
        }),
        { code: "first_publication_package_metadata_apply_busy" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a journal that attempts to redirect a recovery target", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await assert.rejects(
        applyFirstPublicationPackageMetadataFiles(applyFilesystemInput(fixture), {
          ownerPid: 2_147_483_647,
          failureInjector: (current) => (current === "staged" ? "interrupt" : undefined),
        }),
        { code: "first_publication_package_metadata_apply_recovery_required" },
      );
      const journalPath = `${fixture.transactionRoot}/journal.json`;
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      journal.files[0].relativePath = "../../../../outside.json";
      await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
      await assert.rejects(
        recoverFirstPublicationPackageMetadataFiles({
          transactionRoot: fixture.transactionRoot,
          targets: fixture.targets,
        }),
        { code: "first_publication_package_metadata_apply_journal_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
