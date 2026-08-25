import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createCliFirstPublicationStageEvidenceBundle } from "../lib/cli-first-publication-stage-evidence-bundle.mjs";
import { validateFirstPublicationStageEvidenceBundleDocument } from "../lib/first-publication-stage-evidence-bundle.mjs";
import { readFirstPublicationStageEvidenceBundleSources } from "../lib/first-publication-stage-evidence-bundle-sources.mjs";
import { createFirstPublicationStageApprovalReconciliationReport } from "../lib/first-publication-stage-approval-reconciliation.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  createFirstPublicationStageApprovalReconciliationFixture,
  matchingStageApprovalReconciliationObservation,
} from "./fixtures/first-publication-stage-approval-reconciliation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function fixture() {
  const stage = await createFirstPublicationStageApprovalReconciliationFixture();
  const reconciliationReport = createFirstPublicationStageApprovalReconciliationReport({
    stageReviewReport: stage.stageReviewReport,
    authorization: stage.authorization,
    attempt: stage.attempt,
    terminal: stage.terminal,
    observation: matchingStageApprovalReconciliationObservation(stage),
    observedAt: "2026-08-21T10:20:00Z",
  });
  const reconciliationReportPath = resolve(stage.root, "reconciliation.json");
  const outputPath = resolve(stage.root, "stage-evidence-bundle.json");
  await writeFile(reconciliationReportPath, `${JSON.stringify(reconciliationReport, null, 2)}\n`);
  const input = {
    stageReviewReportPath: stage.stageReviewReportPath,
    decisionPath: stage.decisionPath,
    authorizationPath: stage.authorizationPath,
    resultDirectory: stage.resultDirectory,
    reconciliationReportPath,
    outputPath,
    write: true,
  };
  return { stage, reconciliationReport, reconciliationReportPath, outputPath, input };
}

describe("first-publication stage evidence bundle manifest", () => {
  it("stores only bounded relative coordinates and source digests", async () => {
    const value = await fixture();
    try {
      const bundle = await createCliFirstPublicationStageEvidenceBundle(value.input);
      assert.equal(bundle.pathBase, "manifest_directory");
      assert.equal(bundle.sourceOwnership, "referenced_primary_documents");
      assert.equal(bundle.sources.decision.path, "decision.json");
      assert.equal(bundle.sources.approvalResult.directory, "approval-result");
      assert.equal(
        bundle.sources.reconciliationReport.digest,
        value.reconciliationReport.evidenceDigest,
      );
      const serialized = JSON.stringify(bundle);
      assert.equal(serialized.includes(value.stage.root), false);
      assert.equal(serialized.includes("@lervo/cli"), false);
      assert.equal(serialized.includes("public_release_confirmed"), false);
      if (process.platform !== "win32") {
        assert.equal((await stat(value.outputPath)).mode & 0o777, 0o600);
      }
      const sources = await readFirstPublicationStageEvidenceBundleSources(value.outputPath);
      assert.equal(
        sources.reconciliationReport.evidenceDigest,
        value.reconciliationReport.evidenceDigest,
      );
      await sources.assertUnchanged();
      await assert.rejects(createCliFirstPublicationStageEvidenceBundle(value.input), {
        code: "first_publication_stage_evidence_bundle_output_exists",
      });
    } finally {
      await rm(value.stage.root, { recursive: true, force: true });
    }
  });

  it("rejects changed originals and redigested path traversal", async () => {
    const changed = await fixture();
    try {
      await createCliFirstPublicationStageEvidenceBundle(changed.input);
      await writeFile(changed.stage.decisionPath, "{}\n");
      await assert.rejects(readFirstPublicationStageEvidenceBundleSources(changed.outputPath));
    } finally {
      await rm(changed.stage.root, { recursive: true, force: true });
    }

    const traversal = await fixture();
    try {
      const bundle = await createCliFirstPublicationStageEvidenceBundle(traversal.input);
      const forged = structuredClone(bundle);
      forged.sources.decision.path = "../decision.json";
      const { bundleDigest: _digest, ...body } = forged;
      forged.bundleDigest = canonicalDigest(body);
      assert.throws(() => validateFirstPublicationStageEvidenceBundleDocument(forged), {
        code: "first_publication_stage_evidence_bundle_invalid",
      });

      const mismatched = structuredClone(bundle);
      mismatched.sources.decision.digest = `sha256:${"f".repeat(64)}`;
      const { bundleDigest: _old, ...mismatchedBody } = mismatched;
      mismatched.bundleDigest = canonicalDigest(mismatchedBody);
      await writeFile(traversal.outputPath, `${JSON.stringify(mismatched, null, 2)}\n`);
      await assert.rejects(readFirstPublicationStageEvidenceBundleSources(traversal.outputPath), {
        code: "first_publication_stage_evidence_bundle_source_mismatch",
      });
    } finally {
      await rm(traversal.stage.root, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")("rejects a manifest with broad permissions", async () => {
    const value = await fixture();
    try {
      await createCliFirstPublicationStageEvidenceBundle(value.input);
      await chmod(value.outputPath, 0o644);
      await assert.rejects(readFirstPublicationStageEvidenceBundleSources(value.outputPath), {
        code: "first_publication_stage_evidence_bundle_source_invalid",
      });
    } finally {
      await rm(value.stage.root, { recursive: true, force: true });
    }
  });

  it("does not create a manifest that references sources outside its directory", async () => {
    const value = await fixture();
    const outside = resolve(value.stage.root, "nested", "bundle.json");
    try {
      let reads = 0;
      await assert.rejects(
        createCliFirstPublicationStageEvidenceBundle(
          {
            ...value.input,
            outputPath: outside,
          },
          {
            readSources: async () => {
              reads += 1;
            },
          },
        ),
        { code: "first_publication_stage_evidence_bundle_path_invalid" },
      );
      assert.equal(reads, 0);
      await assert.rejects(access(outside), { code: "ENOENT" });
    } finally {
      await rm(value.stage.root, { recursive: true, force: true });
    }
  });

  it("accepts only complete absolute write coordinates", async () => {
    const value = await fixture();
    try {
      const args = [
        "--stage-review-report",
        value.input.stageReviewReportPath,
        "--decision",
        value.input.decisionPath,
        "--authorization",
        value.input.authorizationPath,
        "--result-directory",
        value.input.resultDirectory,
        "--reconciliation-report",
        value.input.reconciliationReportPath,
        "--output",
        value.input.outputPath,
      ];
      for (const invalid of [
        args,
        [...args, "--write", "--write"],
        [...args.slice(0, -2), "--write"],
        [
          ...args.map((item) => (item === value.input.decisionPath ? "decision.json" : item)),
          "--write",
        ],
        [...args, "--write", "--online"],
      ]) {
        const result = spawnSync(
          process.execPath,
          ["scripts/create-cli-first-publication-stage-evidence-bundle.mjs", ...invalid],
          { cwd: repositoryRoot, encoding: "utf8" },
        );
        assert.equal(result.status, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /^first_publication_stage_evidence_bundle_arguments_invalid:/u);
      }
    } finally {
      await rm(value.stage.root, { recursive: true, force: true });
    }
  });
});
