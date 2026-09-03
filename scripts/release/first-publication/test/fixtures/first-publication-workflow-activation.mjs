import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parse } from "yaml";

import { applyCliFirstPublicationWorkflowActivation } from "../../workflow/cli-first-publication-workflow-activation-apply.mjs";
import { authorizeCliFirstPublicationWorkflowActivation } from "../../workflow/cli-first-publication-workflow-activation-permit.mjs";
import { createFirstPublicationWorkflowActivationDecision } from "../../workflow/first-publication-workflow-activation-decision.mjs";
import { createFirstPublicationWorkflowActivationCandidate } from "../../workflow/first-publication-workflow-activation-candidate.mjs";
import { npmPublicRegistry } from "../../../lib/release-publication-authorization.mjs";
import { sha256 } from "../../../../shared/release-artifact-manifest.mjs";

export const workflowActivationRepository = "lervo-dev/lervo";
const repositoryRoot = resolve(import.meta.dirname, "../../../../..");

function snapshot(contents) {
  return { contents, byteCount: contents.length, sha256: sha256(contents) };
}

export function readyWorkflowActivationNpmObservation(overrides = {}) {
  return {
    schemaVersion: 1,
    source: "npm_trust",
    state: "configured",
    package: "@lervo/cli",
    provider: "github",
    repository: workflowActivationRepository,
    workflow: "cli-release-matrix.yml",
    environment: "npm-release",
    permissions: ["createStagedPackage"],
    ...overrides,
  };
}

export function readyWorkflowActivationGitHubObservation(overrides = {}) {
  return {
    schemaVersion: 1,
    source: "github_environment",
    state: "observed",
    repository: workflowActivationRepository,
    environment: "npm-release",
    requiredReviewerCount: 1,
    preventSelfReview: true,
    tagPolicies: ["v*"],
    ...overrides,
  };
}

export async function createWorkflowActivationFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workflow-activation-"));
  const paths = {
    packageManifestPath: resolve(root, "package.json"),
    cliPackageManifestPath: resolve(root, "apps/cli/package.json"),
    workflowPath: resolve(root, ".github/workflows/cli-release-matrix.yml"),
  };
  await Promise.all([
    mkdir(resolve(root, "apps/cli"), { recursive: true }),
    mkdir(resolve(root, ".github/workflows"), { recursive: true }),
  ]);
  const [rootPackageContents, workflowContents, currentCliPackageContents] = await Promise.all([
    readFile(resolve(repositoryRoot, "package.json")),
    readFile(resolve(repositoryRoot, ".github/workflows/cli-release-matrix.yml")),
    readFile(resolve(repositoryRoot, "apps/cli/package.json")),
  ]);
  const cliPackage = JSON.parse(currentCliPackageContents.toString("utf8"));
  cliPackage.license = "MIT";
  cliPackage.repository = {
    type: "git",
    url: `git+https://github.com/${workflowActivationRepository}.git`,
  };
  cliPackage.publishConfig = {
    access: "public",
    registry: npmPublicRegistry,
  };
  const cliPackageContents = Buffer.from(`${JSON.stringify(cliPackage, null, 2)}\n`);
  await Promise.all([
    writeFile(paths.packageManifestPath, rootPackageContents),
    writeFile(paths.cliPackageManifestPath, cliPackageContents),
    writeFile(paths.workflowPath, workflowContents, { mode: 0o640 }),
  ]);
  const candidateInput = {
    packageManifest: JSON.parse(rootPackageContents.toString("utf8")),
    workflow: parse(workflowContents.toString("utf8")),
    packageSnapshot: snapshot(rootPackageContents),
    workflowSnapshot: snapshot(workflowContents),
  };
  const candidateResult = createFirstPublicationWorkflowActivationCandidate(candidateInput);
  const decision = createFirstPublicationWorkflowActivationDecision({
    decisionId: `wfa_${"a".repeat(24)}`,
    candidateDigest: candidateResult.candidate.candidateDigest,
    packageSourceSha256: candidateResult.candidate.sources.package.sha256,
    workflowSourceSha256: candidateResult.candidate.sources.workflow.sha256,
    outputSha256: candidateResult.candidate.output.sha256,
    decidedAt: "2026-08-21T10:00:00Z",
    expiresAt: "2026-08-21T10:10:00Z",
  });
  const decisionPath = resolve(root, "decision.json");
  const permitPath = resolve(root, "permit.json");
  await writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`);
  return {
    root,
    paths,
    decision,
    decisionPath,
    permitPath,
    candidateResult,
    workflowContents,
  };
}

function sequence(...values) {
  return () => values.shift();
}

export async function createAppliedWorkflowActivationFixture() {
  const fixture = await createWorkflowActivationFixture();
  const transactionRoot = resolve(fixture.root, ".github/.workflow-activation-transaction");
  await authorizeCliFirstPublicationWorkflowActivation(
    {
      repository: workflowActivationRepository,
      decisionPath: fixture.decisionPath,
      outputPath: fixture.permitPath,
      online: true,
    },
    {
      paths: fixture.paths,
      observeNpm: async () => readyWorkflowActivationNpmObservation(),
      observeGitHub: async () => readyWorkflowActivationGitHubObservation(),
      clock: sequence("2026-08-21T10:01:00Z", "2026-08-21T10:02:00Z"),
    },
  );
  const receipt = await applyCliFirstPublicationWorkflowActivation(
    {
      repository: workflowActivationRepository,
      decisionPath: fixture.decisionPath,
      permitPath: fixture.permitPath,
      online: true,
    },
    {
      paths: fixture.paths,
      transactionRoot,
      observeNpm: async () => readyWorkflowActivationNpmObservation(),
      observeGitHub: async () => readyWorkflowActivationGitHubObservation(),
      clock: sequence("2026-08-21T10:03:00Z", "2026-08-21T10:04:00Z", "2026-08-21T10:05:00Z"),
    },
  );
  const receiptPath = resolve(fixture.root, "workflow-activation-receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { ...fixture, receipt, receiptPath, transactionRoot };
}
