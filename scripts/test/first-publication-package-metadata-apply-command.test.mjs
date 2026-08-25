import assert from "node:assert/strict";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { applyCliFirstPublicationPackageMetadata } from "../lib/cli-first-publication-package-metadata-apply.mjs";
import { parseFirstPublicationPackageMetadataApplyArguments } from "../lib/first-publication-package-metadata-apply-cli-arguments.mjs";
import { formatFirstPublicationPackageMetadataApplyReceipt } from "../lib/first-publication-package-metadata-apply-formatter.mjs";
import { createMetadataApplyFixture } from "./fixtures/first-publication-metadata-apply.mjs";

describe("first-publication package metadata apply command", () => {
  it("requires an absolute permit and explicit write or an isolated recovery mode", () => {
    assert.deepEqual(
      parseFirstPublicationPackageMetadataApplyArguments([
        "--permit",
        "/tmp/permit.json",
        "--write",
        "--json",
      ]),
      { mode: "apply", permitPath: "/tmp/permit.json", json: true },
    );
    assert.deepEqual(parseFirstPublicationPackageMetadataApplyArguments(["--recover"]), {
      mode: "recover",
      json: false,
    });
    for (const args of [
      [],
      ["--permit", "relative.json", "--write"],
      ["--permit", "/tmp/permit.json"],
      ["--write"],
      ["--recover", "--write"],
      ["--recover", "--permit", "/tmp/permit.json"],
      ["--permit", "/tmp/permit.json", "--write", "--online"],
      ["--permit", "/tmp/permit.json", "--write", "--write"],
    ]) {
      assert.throws(() => parseFirstPublicationPackageMetadataApplyArguments(args), {
        code: "first_publication_package_metadata_apply_arguments_invalid",
      });
    }
  });

  it("applies the exact package, regenerated manifest, and regenerated SBOM", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const receipt = await applyCliFirstPublicationPackageMetadata(
        fixture.permitPath,
        fixture.paths,
        {
          transactionRoot: fixture.transactionRoot,
          generateDerived: async () => fixture.derivedRelease,
        },
      );
      assert.equal(receipt.status, "applied");
      assert.equal(receipt.effects.packageMetadata, "changed");
      assert.equal(receipt.effects.releaseManifest, "regenerated");
      assert.equal(receipt.effects.releaseSbom, "regenerated");
      assert.deepEqual(
        await Promise.all([
          readFile(fixture.paths.packageManifestPath),
          readFile(fixture.paths.releaseManifestPath),
          readFile(fixture.paths.releaseSbomPath),
        ]),
        [
          fixture.planResult.outputBytes.packageManifest,
          fixture.planResult.outputBytes.releaseManifest,
          fixture.planResult.outputBytes.releaseSbom,
        ],
      );
      await assert.rejects(access(fixture.transactionRoot));
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a source change during generation before transaction state is created", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await assert.rejects(
        applyCliFirstPublicationPackageMetadata(fixture.permitPath, fixture.paths, {
          transactionRoot: fixture.transactionRoot,
          generateDerived: async () => {
            await writeFile(fixture.paths.lockfilePath, "lockfileVersion: 'changed'\n");
            return fixture.derivedRelease;
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
      await assert.rejects(access(fixture.transactionRoot));
      assert.deepEqual(
        await readFile(fixture.paths.packageManifestPath),
        fixture.sources.sourceSnapshots.packageManifest.contents,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("blocks a new apply before reading sources when recovery state exists", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await mkdir(fixture.transactionRoot);
      await writeFile(`${fixture.transactionRoot}/journal.json`, "{}\n");
      let reads = 0;
      await assert.rejects(
        applyCliFirstPublicationPackageMetadata(fixture.permitPath, fixture.paths, {
          transactionRoot: fixture.transactionRoot,
          readSources: async () => {
            reads += 1;
            return fixture.sources;
          },
        }),
        { code: "first_publication_package_metadata_apply_recovery_required" },
      );
      assert.equal(reads, 0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps digests out of the human completion message", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const receipt = await applyCliFirstPublicationPackageMetadata(
        fixture.permitPath,
        fixture.paths,
        {
          transactionRoot: fixture.transactionRoot,
          generateDerived: async () => fixture.derivedRelease,
        },
      );
      const output = formatFirstPublicationPackageMetadataApplyReceipt(receipt);
      assert.match(output, /Replaced package\.json with the reviewed candidate/u);
      assert.match(output, /Rebuilt the release manifest/u);
      assert.match(
        output,
        /No approval, publishing activation, or package publication was performed/u,
      );
      assert.equal(output.includes(receipt.receiptDigest), false);
      assert.equal(output.includes(receipt.planDigest), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
