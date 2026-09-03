import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { inspectCliFirstPublicationActivationBlockers } from "../cli-first-publication-activation-blockers.mjs";
import { formatFirstPublicationActivationBlockerReport } from "../first-publication-activation-blocker-formatter.mjs";
import { createFirstPublicationActivationBlockerReport } from "../first-publication-activation-blockers.mjs";
import {
  activationRepositoryRoot,
  createActivationSourceFiles,
  currentActivationSources,
} from "../../test/fixtures/first-publication-activation.mjs";

describe("first-publication activation blocker command", () => {
  it("reads bounded snapshots without creating report files", async () => {
    const prepared = await createActivationSourceFiles();
    try {
      const before = await readdir(prepared.root);
      const report = await inspectCliFirstPublicationActivationBlockers(prepared.paths);
      assert.equal(report.status, "blocked");
      assert.deepEqual(await readdir(prepared.root), before);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects local source changes made while the report is built", async () => {
    const prepared = await createActivationSourceFiles();
    try {
      await assert.rejects(
        inspectCliFirstPublicationActivationBlockers(prepared.paths, {
          createReport: async (sources) => {
            const report = createFirstPublicationActivationBlockerReport(sources);
            await writeFile(prepared.paths.packageManifestPath, JSON.stringify({ changed: true }));
            return report;
          },
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("uses plain English and does not expose source digests", async () => {
    const report = createFirstPublicationActivationBlockerReport(await currentActivationSources());
    const output = formatFirstPublicationActivationBlockerReport(report);
    assert.match(output, /activation is not yet allowed/u);
    assert.match(output, /package\.json has no GitHub repository/u);
    assert.match(output, /verify control of the @lervo npm scope/u);
    assert.match(
      output,
      /did not perform online checks, modify files, create approvals, activate publication, or publish a package/u,
    );
    assert.equal(output.includes(report.blockerReportDigest), false);
    assert.equal(output.includes(report.sources.packageManifestDigest), false);
  });

  it("prints the current canonical report without clearing its blockers", () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/release/first-publication/transition/commands/show-cli-first-publication-activation-blockers.mjs",
        "--json",
      ],
      { cwd: activationRepositoryRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "blocked");
    assert.equal(report.activation, "not_implemented");
    assert.match(report.blockerReportDigest, /^sha256:[a-f0-9]{64}$/u);
  });

  it("rejects online, duplicate JSON, and unknown arguments", () => {
    for (const args of [["--online"], ["--json", "--json"], ["--unknown"]]) {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/release/first-publication/transition/commands/show-cli-first-publication-activation-blockers.mjs",
          ...args,
        ],
        { cwd: activationRepositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_activation_blocker_arguments_invalid:/u);
    }
  });

  it("does not expose malformed source contents or paths", async () => {
    const prepared = await createActivationSourceFiles();
    try {
      const secret = "secret-package-value";
      await writeFile(prepared.paths.packageManifestPath, `{\"secret\":\"${secret}\"`);
      await assert.rejects(
        inspectCliFirstPublicationActivationBlockers(prepared.paths),
        (error) => {
          assert.equal(error.code, "first_publication_activation_blocker_source_invalid");
          assert.equal(error.message.includes(secret), false);
          assert.equal(error.message.includes(prepared.paths.packageManifestPath), false);
          return true;
        },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });
});
