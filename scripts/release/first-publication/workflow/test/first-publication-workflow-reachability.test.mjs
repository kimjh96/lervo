import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { describe, it } from "vitest";

import {
  createFirstPublicationWorkflowReachabilityEvidence,
  validateFirstPublicationWorkflowReachabilityEvidence,
} from "../first-publication-workflow-reachability-evidence.mjs";
import { readFirstPublicationWorkflowReachabilitySources } from "../first-publication-workflow-reachability-sources.mjs";
import { canonicalDigest, sha256 } from "../../../../shared/release-artifact-manifest.mjs";
import {
  createWorkflowReachabilityFixture,
  matchingWorkflowReachabilityObservation,
  workflowReleaseTag,
} from "../../test/fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from "../../test/fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from "../../test/fixtures/first-publication-workflow-activation.mjs";

async function evidenceInput(fixture, overrides = {}) {
  const sources = await readFirstPublicationWorkflowReachabilitySources(
    { cliPackageManifestPath: fixture.paths.cliPackageManifestPath },
    fixture.remoteEvidenceReportPath,
  );
  return {
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    releaseTag: workflowReleaseTag,
    remoteEvidenceReport: sources.remoteEvidenceReport,
    cliPackage: sources.cliPackage,
    packageSnapshot: sources.packageSnapshot,
    reachabilityObservation: matchingWorkflowReachabilityObservation(fixture),
    observedAt: "2026-08-21T10:08:00Z",
    ...overrides,
  };
}

describe("first-publication workflow reachability evidence", () => {
  it("binds default-branch ancestry and the exact release tag without claiming execution", async () => {
    const fixture = await createWorkflowReachabilityFixture();
    try {
      const input = await evidenceInput(fixture);
      const report = createFirstPublicationWorkflowReachabilityEvidence(input);
      assert.equal(report.status, "evidence_bound");
      assert.equal(report.reachability, "source_on_default_branch_and_exact_release_tag");
      assert.equal(report.github.defaultBranch.relation, "source_commit_ancestor_or_equal");
      assert.equal(report.github.releaseTag.commit, workflowRemoteSourceCommit);
      assert.equal(report.limitations.upstreamEvidenceAuthenticity, "not_verified");
      assert.equal(report.limitations.defaultBranchAfterObservation, "not_verified");
      assert.equal(report.limitations.releaseTagImmutability, "not_verified");
      assert.equal(report.limitations.workflowExecution, "not_observed");
      assert.equal(report.sideEffects.gitReferences, "observed_not_changed");
      assert.equal(report.sideEffects.workflowDispatch, "not_attempted");
      assert.equal(validateFirstPublicationWorkflowReachabilityEvidence(report, input), report);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects non-ancestor branches and tags that resolve to another commit", async () => {
    const fixture = await createWorkflowReachabilityFixture();
    try {
      const input = await evidenceInput(fixture);
      for (const observation of [
        matchingWorkflowReachabilityObservation(fixture, {
          defaultBranch: {
            ...input.reachabilityObservation.defaultBranch,
            relation: "source_commit_not_ancestor",
          },
        }),
        matchingWorkflowReachabilityObservation(fixture, {
          releaseTag: {
            ...input.reachabilityObservation.releaseTag,
            commit: "a".repeat(40),
          },
        }),
      ]) {
        assert.throws(
          () =>
            createFirstPublicationWorkflowReachabilityEvidence({
              ...input,
              reachabilityObservation: observation,
            }),
          { code: "first_publication_workflow_reachability_not_ready" },
        );
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects target mismatch and a release tag that differs from package version", async () => {
    const fixture = await createWorkflowReachabilityFixture();
    try {
      const input = await evidenceInput(fixture);
      assert.throws(
        () =>
          createFirstPublicationWorkflowReachabilityEvidence({
            ...input,
            sourceCommit: "a".repeat(40),
          }),
        { code: "first_publication_workflow_reachability_source_mismatch" },
      );
      assert.throws(
        () =>
          createFirstPublicationWorkflowReachabilityEvidence({
            ...input,
            releaseTag: "v0.1.1",
          }),
        { code: "first_publication_workflow_reachability_input_invalid" },
      );
      const changedPackage = Buffer.from("{}\n");
      assert.throws(
        () =>
          createFirstPublicationWorkflowReachabilityEvidence({
            ...input,
            reachabilityObservation: matchingWorkflowReachabilityObservation(fixture, {
              sourcePackage: {
                ...input.reachabilityObservation.sourcePackage,
                contents: changedPackage,
                byteCount: changedPackage.length,
                sha256: sha256(changedPackage),
              },
            }),
          }),
        { code: "first_publication_workflow_reachability_source_mismatch" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects redigested upstream authority and a stronger final claim", async () => {
    const fixture = await createWorkflowReachabilityFixture();
    try {
      const input = await evidenceInput(fixture);
      const forgedUpstream = structuredClone(input.remoteEvidenceReport);
      forgedUpstream.limitations.defaultBranch = "verified";
      const { evidenceDigest: _upstreamDigest, ...upstreamBody } = forgedUpstream;
      forgedUpstream.evidenceDigest = canonicalDigest(upstreamBody);
      assert.throws(
        () =>
          createFirstPublicationWorkflowReachabilityEvidence({
            ...input,
            remoteEvidenceReport: forgedUpstream,
          }),
        { code: "first_publication_workflow_remote_deployment_report_invalid" },
      );

      const forgedReport = structuredClone(
        createFirstPublicationWorkflowReachabilityEvidence(input),
      );
      forgedReport.limitations.releaseTagImmutability = "verified";
      const { evidenceDigest: _reportDigest, ...reportBody } = forgedReport;
      forgedReport.evidenceDigest = canonicalDigest(reportBody);
      assert.throws(
        () => validateFirstPublicationWorkflowReachabilityEvidence(forgedReport, input),
        { code: "first_publication_workflow_reachability_report_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
