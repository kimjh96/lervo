import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import {
  createFirstPublicationWorkflowRemoteDeploymentEvidence,
  validateFirstPublicationWorkflowRemoteDeploymentEvidence,
} from "../lib/first-publication-workflow-remote-deployment-evidence.mjs";
import { readFirstPublicationWorkflowRemoteDeploymentSources } from
  "../lib/first-publication-workflow-remote-deployment-sources.mjs";
import { canonicalDigest, sha256 } from "../lib/release-artifact-manifest.mjs";
import {
  createWorkflowRemoteDeploymentFixture,
  matchingRemoteWorkflowObservation,
  workflowRemoteSourceCommit,
} from "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from
  "./fixtures/first-publication-workflow-activation.mjs";

async function evidenceInput(fixture, overrides = {}) {
  const sources = await readFirstPublicationWorkflowRemoteDeploymentSources(
    { workflowPath: fixture.paths.workflowPath },
    fixture.postApplyReportPath,
  );
  return {
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    postApplyReport: sources.postApplyReport,
    workflowSnapshot: sources.workflowSnapshot,
    remoteObservation: await matchingRemoteWorkflowObservation(fixture),
    observedAt: "2026-08-21T10:07:00Z",
    transactionState: { status: "clear" },
    ...overrides,
  };
}

describe("first-publication workflow remote deployment evidence", () => {
  it("binds exact remote bytes without claiming reachability or execution", async () => {
    const fixture = await createWorkflowRemoteDeploymentFixture();
    try {
      const input = await evidenceInput(fixture);
      const report = createFirstPublicationWorkflowRemoteDeploymentEvidence(input);
      assert.equal(report.status, "evidence_bound");
      assert.equal(report.remoteSource, "exact_workflow_present_at_source_commit");
      assert.equal(report.checks.every(({ status }) => status === "ready"), true);
      assert.equal(report.limitations.sourceCommitReachability, "exact_commit_only");
      assert.equal(report.limitations.defaultBranch, "not_verified");
      assert.equal(report.limitations.releaseTag, "not_verified");
      assert.equal(report.limitations.workflowExecution, "not_observed");
      assert.equal(report.limitations.stageSubmission, "not_observed");
      assert.equal(report.sideEffects.workflowDispatch, "not_attempted");
      assert.equal(report.sideEffects.publication, "not_attempted");
      assert.equal("contents" in report.remote, false);
      assert.equal(validateFirstPublicationWorkflowRemoteDeploymentEvidence(
        report,
        input,
      ), report);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects mismatched repositories, observations, and exact bytes", async () => {
    const fixture = await createWorkflowRemoteDeploymentFixture();
    try {
      const input = await evidenceInput(fixture);
      assert.throws(
        () => createFirstPublicationWorkflowRemoteDeploymentEvidence({
          ...input,
          repository: "other/repository",
        }),
        { code: "first_publication_workflow_remote_deployment_source_mismatch" },
      );
      assert.throws(
        () => createFirstPublicationWorkflowRemoteDeploymentEvidence({
          ...input,
          remoteObservation: {
            ...input.remoteObservation,
            sourceCommit: "e".repeat(40),
          },
        }),
        { code: "first_publication_workflow_remote_deployment_observation_invalid" },
      );
      const changed = Buffer.from(input.remoteObservation.contents.toString().replace(
        "name:", "name: ",
      ));
      assert.throws(
        () => createFirstPublicationWorkflowRemoteDeploymentEvidence({
          ...input,
          remoteObservation: {
            ...input.remoteObservation,
            contents: changed,
            byteCount: changed.length,
            sha256: sha256(changed),
          },
        }),
        { code: "first_publication_workflow_remote_deployment_bytes_mismatch" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a redigested stronger evidence claim", async () => {
    const fixture = await createWorkflowRemoteDeploymentFixture();
    try {
      const input = await evidenceInput(fixture);
      const forged = structuredClone(
        createFirstPublicationWorkflowRemoteDeploymentEvidence(input),
      );
      forged.limitations.defaultBranch = "verified";
      const { evidenceDigest: _digest, ...body } = forged;
      forged.evidenceDigest = canonicalDigest(body);
      assert.throws(
        () => validateFirstPublicationWorkflowRemoteDeploymentEvidence(forged, input),
        { code: "first_publication_workflow_remote_deployment_report_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("does not let a redigested local report bless a changed action SHA", async () => {
    const fixture = await createWorkflowRemoteDeploymentFixture();
    try {
      const current = await readFile(fixture.paths.workflowPath, "utf8");
      const changed = Buffer.from(current.replaceAll(
        "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
        `actions/checkout@${"b".repeat(40)}`,
      ));
      await writeFile(fixture.paths.workflowPath, changed);
      const forged = structuredClone(fixture.postApplyReport);
      forged.sources.workflowSha256 = sha256(changed);
      const { reportDigest: _digest, ...body } = forged;
      forged.reportDigest = canonicalDigest(body);
      await writeFile(
        fixture.postApplyReportPath,
        `${JSON.stringify(forged, null, 2)}\n`,
      );
      const input = await evidenceInput(fixture, {
        remoteObservation: await matchingRemoteWorkflowObservation(fixture),
      });
      assert.throws(
        () => createFirstPublicationWorkflowRemoteDeploymentEvidence(input),
        { code: "first_publication_workflow_remote_deployment_not_ready" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
