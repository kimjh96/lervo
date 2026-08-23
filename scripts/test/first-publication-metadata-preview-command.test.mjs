import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { inspectCliFirstPublicationMetadataPreview } from
  "../lib/cli-first-publication-metadata-preview.mjs";
import { createFirstPublicationMetadataDecision } from
  "../lib/first-publication-metadata-decision.mjs";
import { createFirstPublicationMetadataPreview } from
  "../lib/first-publication-metadata-preview.mjs";
import { formatFirstPublicationMetadataPreview } from
  "../lib/first-publication-metadata-preview-formatter.mjs";
import {
  activationRepository,
  activationRepositoryRoot,
  createActivationSourceFiles,
  currentActivationSources,
} from "./fixtures/first-publication-activation.mjs";

const command = "scripts/show-cli-first-publication-metadata-preview.mjs";
const validArguments = [
  "--repository", activationRepository,
  "--license", "Apache-2.0",
  "--scope-owner-kind", "organization",
  "--scope-owner-name", "lervo",
];

function decision() {
  return createFirstPublicationMetadataDecision({
    repository: activationRepository,
    license: "Apache-2.0",
    scopeOwnerKind: "organization",
    scopeOwnerName: "lervo",
  });
}

describe("first-publication metadata preview command", () => {
  it("reads immutable snapshots without creating preview files", async () => {
    const prepared = await createActivationSourceFiles();
    try {
      const before = await readdir(prepared.root);
      const preview = await inspectCliFirstPublicationMetadataPreview(
        decision(),
        prepared.paths,
      );
      assert.equal(preview.status, "changes_required");
      assert.deepEqual(await readdir(prepared.root), before);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects source changes made while the preview is built", async () => {
    const prepared = await createActivationSourceFiles();
    try {
      await assert.rejects(inspectCliFirstPublicationMetadataPreview(
        decision(),
        prepared.paths,
        {
          createPreview: async (sources) => {
            const preview = createFirstPublicationMetadataPreview(sources);
            await writeFile(prepared.paths.packageManifestPath, JSON.stringify({ changed: true }));
            return preview;
          },
        },
      ), { code: "release_attestation_release_set_changed" });
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("uses plain English and keeps the non-writing boundary visible", async () => {
    const preview = createFirstPublicationMetadataPreview({
      ...await currentActivationSources(),
      decision: decision(),
    });
    const output = formatFirstPublicationMetadataPreview(preview);
    assert.match(output, /This selection is not publication approval/u);
    assert.match(output, /Set the GitHub repository to git\+https:\/\/github\.com\/lervo-dev\/lervo\.git/u);
    assert.match(output, /Do not edit the generated file directly/u);
    assert.match(output, /did not perform online checks, modify files, regenerate the release manifest, create approvals/u);
    assert.equal(output.includes(preview.metadataPreviewDigest), false);
    assert.equal(output.includes(preview.sources.packageManifestDigest), false);
  });

  it("prints canonical JSON and leaves both repository manifests unchanged", async () => {
    const packagePath = resolve(activationRepositoryRoot, "apps/cli/package.json");
    const releasePath = resolve(
      activationRepositoryRoot,
      "apps/cli/release-artifact-manifest.json",
    );
    const before = await Promise.all([readFile(packagePath), readFile(releasePath)]);
    const result = spawnSync(process.execPath, [command, ...validArguments, "--json"], {
      cwd: activationRepositoryRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const preview = JSON.parse(result.stdout);
    assert.equal(preview.status, "changes_required");
    assert.equal(preview.activation, "not_implemented");
    assert.equal(preview.packageManifestChanges.length, 4);
    assert.match(preview.metadataPreviewDigest, /^sha256:[a-f0-9]{64}$/u);
    const after = await Promise.all([readFile(packagePath), readFile(releasePath)]);
    assert.deepEqual(after, before);
  });

  it("rejects missing, duplicate, online, and unknown arguments", () => {
    const cases = [
      [],
      [...validArguments, "--license", "MIT"],
      [...validArguments, "--online"],
      [...validArguments, "--unknown", "value"],
    ];
    for (const args of cases) {
      const result = spawnSync(process.execPath, [command, ...args], {
        cwd: activationRepositoryRoot,
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_metadata_preview_arguments_invalid:/u);
    }
  });

  it("does not expose invalid decision values in errors", () => {
    const secret = "secret-license-value";
    const result = spawnSync(process.execPath, [
      command,
      ...validArguments.slice(0, 2),
      "--license", `${secret}\nunsafe`,
      ...validArguments.slice(4),
    ], { cwd: activationRepositoryRoot, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^first_publication_metadata_decision_invalid:/u);
    assert.equal(result.stderr.includes(secret), false);
  });
});
