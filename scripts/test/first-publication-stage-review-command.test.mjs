import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createCliFirstPublicationStageReviewEvidence } from
  "../lib/cli-first-publication-stage-review.mjs";
import { createCliFirstPublicationStageResultEvidence } from
  "../lib/cli-first-publication-stage-result.mjs";
import { parseFirstPublicationStageReviewArguments } from
  "../lib/first-publication-stage-review-cli-arguments.mjs";
import { formatFirstPublicationStageReviewEvidence } from
  "../lib/first-publication-stage-review-formatter.mjs";
import { validateFirstPublicationStageReviewReportDocument } from
  "../lib/first-publication-stage-review-report.mjs";
import { canonicalDigest, sha256 } from "../lib/release-artifact-manifest.mjs";
import {
  createFirstPublicationStageResultFixture,
  matchingStageResultObservation,
} from "./fixtures/first-publication-stage-result.mjs";
import {
  workflowExecutionAttempt,
  workflowExecutionRunId,
} from "./fixtures/first-publication-workflow-execution.mjs";
import { workflowReleaseTag } from
  "./fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from
  "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from
  "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function fixture() {
  const value = await createFirstPublicationStageResultFixture();
  const stageResultReport = await createCliFirstPublicationStageResultEvidence({
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    releaseTag: workflowReleaseTag,
    runId: workflowExecutionRunId,
    attempt: workflowExecutionAttempt,
    workflowExecutionReportPath: value.workflowExecutionReportPath,
    online: true,
  }, {
    observeStageResult: async () => matchingStageResultObservation(value),
    clock: () => "2026-08-21T10:14:00Z",
  });
  const stageResultReportPath = resolve(value.root, "stage-result.json");
  const npmUserConfigPath = resolve(value.root, "user.npmrc");
  await writeFile(stageResultReportPath, `${JSON.stringify(stageResultReport, null, 2)}\n`);
  await writeFile(npmUserConfigPath, "//registry.npmjs.org/:_authToken=fixture\n");
  return { ...value, stageResultReport, stageResultReportPath, npmUserConfigPath };
}

function observation(value) {
  return {
    schemaVersion: 1,
    source: "npm_staged_package_review",
    state: "observed",
    registry: value.stageResultReport.stage.target.registry,
    package: value.stageResultReport.target.package,
    version: value.stageResultReport.target.version,
    stage: {
      idDigest: sha256("123e4567-e89b-42d3-a456-426614174000"),
      createdAt: "2026-08-21T10:11:00Z",
      distTag: value.stageResultReport.stage.target.distTag,
      shasum: value.stageResultReport.stage.artifact.registryShasum,
    },
    tarball: {
      byteCount: Buffer.byteLength("first-publication-fixture-tarball"),
      sha256: value.stageResultReport.stage.artifact.sha256,
      registryIntegrity: value.stageResultReport.stage.artifact.registryIntegrity,
      registryShasum: value.stageResultReport.stage.artifact.registryShasum,
    },
    metadataStability: "rechecked_unchanged",
    userConfig: "rechecked_unchanged",
    temporaryFiles: "removed",
  };
}

function createEvidence(value, overrides = {}) {
  return createCliFirstPublicationStageReviewEvidence({
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    releaseTag: workflowReleaseTag,
    runId: workflowExecutionRunId,
    attempt: workflowExecutionAttempt,
    stageResultReportPath: value.stageResultReportPath,
    npmUserConfigPath: value.npmUserConfigPath,
    online: true,
  }, {
    observe: async () => observation(value),
    clock: () => "2026-08-21T10:15:00Z",
    ...overrides,
  });
}

describe("first-publication staged package review command", () => {
  it("binds exact stage metadata and tarball without claiming approval", async () => {
    const value = await fixture();
    try {
      const before = await readFile(value.stageResultReportPath);
      const report = await createEvidence(value);
      assert.equal(report.schemaVersion, 2);
      assert.equal(report.review, "exact_staged_package_and_tarball_observed");
      assert.equal(report.limitations.twoFactorApproval, "not_observed");
      assert.equal(report.sideEffects.stageApprove, "not_attempted");
      assert.equal(JSON.stringify(report).includes("123e4567"), false);
      assert.deepEqual(await readFile(value.stageResultReportPath), before);
      assert.match(
        formatFirstPublicationStageReviewEvidence(report),
        /did not approve or reject/u,
      );

      const legacy = structuredClone(report);
      legacy.schemaVersion = 1;
      delete legacy.upstream.publicationAuthorizationDigest;
      const { evidenceDigest: _digest, ...legacyBody } = legacy;
      legacy.evidenceDigest = canonicalDigest(legacyBody);
      assert.equal(validateFirstPublicationStageReviewReportDocument(legacy), legacy);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  it("rejects source races and unavailable observations", async () => {
    const changed = await fixture();
    try {
      await assert.rejects(createEvidence(changed, {
        observe: async () => {
          await writeFile(changed.stageResultReportPath, "{}\n");
          return observation(changed);
        },
      }), { code: "release_attestation_release_set_changed" });
    } finally {
      await rm(changed.root, { recursive: true, force: true });
    }
    const unavailable = await fixture();
    try {
      await assert.rejects(createEvidence(unavailable, {
        observe: async () => ({
          schemaVersion: 1,
          source: "npm_staged_package_review",
          state: "unavailable",
          reason: "stage_not_found",
        }),
      }), { code: "first_publication_stage_review_not_ready" });
    } finally {
      await rm(unavailable.root, { recursive: true, force: true });
    }
  });

  it("accepts only complete read-only online coordinates", () => {
    const valid = [
      "--repository", workflowActivationRepository,
      "--source-commit", workflowRemoteSourceCommit,
      "--release-tag", workflowReleaseTag,
      "--run-id", String(workflowExecutionRunId),
      "--attempt", String(workflowExecutionAttempt),
      "--stage-result-report", "/tmp/stage-result.json",
      "--npm-user-config", "/tmp/user.npmrc",
      "--online", "--json",
    ];
    assert.equal(parseFirstPublicationStageReviewArguments(valid).attempt,
      workflowExecutionAttempt);
    for (const args of [
      [],
      valid.filter((value) => value !== "--online"),
      valid.map((value) => value === "/tmp/user.npmrc" ? "relative" : value),
      [...valid, "--approve"],
      [...valid, "--npm-user-config", "/tmp/other.npmrc"],
    ]) {
      const result = spawnSync(process.execPath, [
        "scripts/show-cli-first-publication-stage-review-evidence.mjs",
        ...args,
      ], { cwd: repositoryRoot, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_stage_review_arguments_invalid:/u);
    }
  });
});
