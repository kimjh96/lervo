import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createCliFirstPublicationWorkflowReachabilityEvidence } from
  "../lib/cli-first-publication-workflow-reachability.mjs";
import { parseFirstPublicationWorkflowReachabilityArguments } from
  "../lib/first-publication-workflow-reachability-cli-arguments.mjs";
import { formatFirstPublicationWorkflowReachabilityEvidence } from
  "../lib/first-publication-workflow-reachability-formatter.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  createWorkflowReachabilityFixture,
  matchingWorkflowReachabilityObservation,
  workflowReleaseTag,
} from "./fixtures/first-publication-workflow-reachability.mjs";
import { workflowRemoteSourceCommit } from
  "./fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowActivationRepository } from
  "./fixtures/first-publication-workflow-activation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");

async function createEvidence(fixture, overrides = {}) {
  return createCliFirstPublicationWorkflowReachabilityEvidence({
    repository: workflowActivationRepository,
    sourceCommit: workflowRemoteSourceCommit,
    releaseTag: workflowReleaseTag,
    remoteEvidenceReportPath: fixture.remoteEvidenceReportPath,
    online: true,
  }, {
    paths: { cliPackageManifestPath: fixture.paths.cliPackageManifestPath },
    observeReachability: async () => matchingWorkflowReachabilityObservation(fixture),
    clock: () => "2026-08-21T10:08:00Z",
    ...overrides,
  });
}

describe("first-publication workflow reachability command", () => {
  it("reads package, evidence, and remote refs without changing local sources", async () => {
    const fixture = await createWorkflowReachabilityFixture();
    try {
      const paths = [
        fixture.paths.cliPackageManifestPath,
        fixture.remoteEvidenceReportPath,
      ];
      const before = await Promise.all(paths.map((path) => readFile(path)));
      const report = await createEvidence(fixture);
      assert.equal(report.status, "evidence_bound");
      assert.deepEqual(await Promise.all(paths.map((path) => readFile(path))), before);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects source changes during GitHub ref observation", async () => {
    const fixture = await createWorkflowReachabilityFixture();
    try {
      await assert.rejects(createEvidence(fixture, {
        observeReachability: async () => {
          await writeFile(fixture.remoteEvidenceReportPath, "{}\n");
          return matchingWorkflowReachabilityObservation(fixture);
        },
      }), { code: "release_attestation_release_set_changed" });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects invalid upstream evidence before opening the remote observer", async () => {
    const fixture = await createWorkflowReachabilityFixture();
    try {
      const forged = structuredClone(fixture.remoteEvidenceReport);
      forged.limitations.releaseTag = "verified";
      const { evidenceDigest: _digest, ...body } = forged;
      forged.evidenceDigest = canonicalDigest(body);
      await writeFile(
        fixture.remoteEvidenceReportPath,
        `${JSON.stringify(forged, null, 2)}\n`,
      );
      let observations = 0;
      await assert.rejects(createEvidence(fixture, {
        observeReachability: async () => {
          observations += 1;
          return matchingWorkflowReachabilityObservation(fixture);
        },
      }), { code: "first_publication_workflow_remote_deployment_report_invalid" });
      assert.equal(observations, 0);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed for unavailable refs and policy mismatches", async () => {
    const fixture = await createWorkflowReachabilityFixture();
    try {
      await assert.rejects(createEvidence(fixture, {
        observeReachability: async () => ({
          schemaVersion: 1,
          source: "github_repository_reachability",
          state: "unavailable",
          reason: "references_changed",
        }),
      }), { code: "first_publication_workflow_reachability_not_ready" });
      await assert.rejects(createEvidence(fixture, {
        observeReachability: async () => matchingWorkflowReachabilityObservation(fixture, {
          releaseTag: {
            ...matchingWorkflowReachabilityObservation(fixture).releaseTag,
            commit: "a".repeat(40),
          },
        }),
      }), { code: "first_publication_workflow_reachability_not_ready" });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("uses clear Korean without exposing evidence digests", async () => {
    const fixture = await createWorkflowReachabilityFixture();
    try {
      const report = await createEvidence(fixture);
      const output = formatFirstPublicationWorkflowReachabilityEvidence(report);
      assert.match(output, /source commit is contained in the current default branch, main/u);
      assert.match(output, /does not guarantee that refs remain unchanged after observation/u);
      assert.match(output, /Workflow execution, npm stage acceptance, 2FA approval/u);
      assert.equal(output.includes(report.evidenceDigest), false);
      assert.equal(output.includes(report.upstream.remoteDeploymentEvidenceDigest), false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects offline, relative, malformed, duplicate, write, and unknown arguments", () => {
    const valid = [
      "--repository", workflowActivationRepository,
      "--source-commit", workflowRemoteSourceCommit,
      "--release-tag", workflowReleaseTag,
      "--remote-evidence-report", "/tmp/remote-evidence.json",
      "--online", "--json",
    ];
    assert.deepEqual(parseFirstPublicationWorkflowReachabilityArguments(valid), {
      repository: workflowActivationRepository,
      sourceCommit: workflowRemoteSourceCommit,
      releaseTag: workflowReleaseTag,
      remoteEvidenceReportPath: "/tmp/remote-evidence.json",
      online: true,
      json: true,
    });
    for (const args of [
      [],
      valid.filter((arg) => arg !== "--online"),
      ["--online", "--repository", workflowActivationRepository,
        "--source-commit", "c".repeat(39), "--release-tag", workflowReleaseTag,
        "--remote-evidence-report", "/tmp/r"],
      ["--online", "--repository", workflowActivationRepository,
        "--source-commit", workflowRemoteSourceCommit, "--release-tag", "latest",
        "--remote-evidence-report", "/tmp/r"],
      ["--online", "--repository", workflowActivationRepository,
        "--source-commit", workflowRemoteSourceCommit,
        "--release-tag", workflowReleaseTag,
        "--remote-evidence-report", "relative"],
      [...valid, "--online"],
      [...valid, "--write"],
      ["--unknown"],
    ]) {
      const result = spawnSync(process.execPath, [
        "scripts/show-cli-first-publication-workflow-reachability-evidence.mjs",
        ...args,
      ], { cwd: repositoryRoot, encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr,
        /^first_publication_workflow_reachability_arguments_invalid:/u);
    }
  });
});
