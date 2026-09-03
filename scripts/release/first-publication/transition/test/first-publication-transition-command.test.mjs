import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import {
  completeCliFirstPublicationTransition,
  writeFirstPublicationTransitionReceipt,
} from "../cli-first-publication-transition.mjs";
import { createCliFirstPublicationStageEvidenceBundle } from "../../stage/cli-first-publication-stage-evidence-bundle.mjs";
import { createFirstPublicationStageApprovalReconciliationReport } from "../../stage/first-publication-stage-approval-reconciliation.mjs";
import { createFileFirstPublicationReservationStore } from "../../adapters/file-first-publication-reservation-store.mjs";
import { canonicalDigest } from "../../../../shared/release-artifact-manifest.mjs";
import { firstPublicationRepository } from "../../test/fixtures/first-publication.mjs";
import { createFirstPublicationFixture } from "../../test/fixtures/first-publication.mjs";
import {
  createFirstPublicationStageApprovalReconciliationFixture,
  matchingStageApprovalReconciliationObservation,
} from "../../test/fixtures/first-publication-stage-approval-reconciliation.mjs";
import { workflowRemoteSourceCommit } from "../../test/fixtures/first-publication-workflow-remote-deployment.mjs";
import { workflowReleaseVersion } from "../../test/fixtures/first-publication-workflow-reachability.mjs";
import {
  createFirstPublicationTransitionFixture,
  firstPublicationStageOnlyWorkflow as stageOnlyWorkflow,
  matchingFirstPublicationGitHubObservation as matchingGitHubObservation,
  matchingFirstPublicationNpmObservation as matchingNpmObservation,
  matchingFirstPublicationPublicObservation as matchingPublicObservation,
} from "../../test/fixtures/first-publication-transition.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../../..");

async function commandFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-transition-command-"));
  const source = createFirstPublicationTransitionFixture({
    armingDecisionId: "arm_transition_command1",
  });
  const documents = source;
  const paths = {
    publicationAuthorizationPath: resolve(root, "publication.json"),
    bootstrapPath: resolve(root, "bootstrap.json"),
    armingAuthorizationPath: resolve(root, "arming.json"),
    workflowPath: resolve(root, "workflow.yml"),
    executionReceiptPath: resolve(root, "execution-receipt.json"),
    reconciliationReportPath: resolve(root, "reconciliation.json"),
    decisionPath: resolve(root, "decision.json"),
    resolutionPath: resolve(root, "resolution.json"),
    reservationRoot: resolve(root, "reservations"),
    outputPath: resolve(root, "transition-receipt.json"),
  };
  const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;
  await Promise.all([
    writeFile(paths.publicationAuthorizationPath, canonical(source.publicationAuthorization)),
    writeFile(paths.bootstrapPath, canonical(source.bootstrap)),
    writeFile(paths.armingAuthorizationPath, canonical(source.armingAuthorization)),
    writeFile(paths.workflowPath, canonical(stageOnlyWorkflow())),
    writeFile(paths.executionReceiptPath, canonical(documents.executionReceipt)),
    writeFile(paths.reconciliationReportPath, canonical(documents.reconciliationReport)),
    writeFile(paths.decisionPath, canonical(documents.decision)),
    writeFile(paths.resolutionPath, canonical(documents.resolution)),
  ]);
  const store = createFileFirstPublicationReservationStore({
    rootDirectory: paths.reservationRoot,
  });
  await store.reserve(documents.reservation);
  await store.markUnknown(documents.terminal);
  return { root, source, documents, paths, store };
}

function observers(source, overrides = {}) {
  return {
    observePublicRelease: async () => matchingPublicObservation(source),
    observeNpm: async () => matchingNpmObservation(),
    observeGitHub: async () => matchingGitHubObservation(),
    clock: () => "2026-08-21T03:04:00Z",
    ...overrides,
  };
}

function options(prepared, evidenceType) {
  const common = {
    online: true,
    evidenceType,
    publicationAuthorizationPath: prepared.paths.publicationAuthorizationPath,
    bootstrapPath: prepared.paths.bootstrapPath,
    armingAuthorizationPath: prepared.paths.armingAuthorizationPath,
    workflowPath: prepared.paths.workflowPath,
  };
  return evidenceType === "execution_receipt"
    ? { ...common, executionReceiptPath: prepared.paths.executionReceiptPath }
    : {
        ...common,
        reservationRoot: prepared.paths.reservationRoot,
        reconciliationReportPath: prepared.paths.reconciliationReportPath,
        decisionPath: prepared.paths.decisionPath,
        resolutionPath: prepared.paths.resolutionPath,
      };
}

async function stageApprovalCommandFixture() {
  const stage = await createFirstPublicationStageApprovalReconciliationFixture();
  const source = createFirstPublicationFixture({
    version: workflowReleaseVersion,
    sourceDigest: workflowRemoteSourceCommit,
  });
  assert.equal(
    source.publicationAuthorization.authorizationDigest,
    stage.publicationAuthorization.authorizationDigest,
  );
  const reconciliationReport = createFirstPublicationStageApprovalReconciliationReport({
    stageReviewReport: stage.stageReviewReport,
    authorization: stage.authorization,
    attempt: stage.attempt,
    terminal: stage.terminal,
    observation: matchingStageApprovalReconciliationObservation(stage),
    observedAt: "2026-08-21T10:20:00Z",
  });
  const paths = {
    publicationAuthorizationPath: resolve(stage.root, "publication.json"),
    bootstrapPath: resolve(stage.root, "bootstrap.json"),
    workflowPath: resolve(stage.root, "workflow.yml"),
    reconciliationPath: resolve(stage.root, "stage-approval-reconciliation.json"),
    bundlePath: resolve(stage.root, "stage-evidence-bundle.json"),
    outputPath: resolve(stage.root, "transition.json"),
  };
  const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;
  await Promise.all([
    writeFile(paths.publicationAuthorizationPath, canonical(source.publicationAuthorization)),
    writeFile(paths.bootstrapPath, canonical(source.bootstrap)),
    writeFile(paths.workflowPath, canonical(stageOnlyWorkflow())),
    writeFile(paths.reconciliationPath, canonical(reconciliationReport)),
  ]);
  await createCliFirstPublicationStageEvidenceBundle({
    stageReviewReportPath: stage.stageReviewReportPath,
    decisionPath: stage.decisionPath,
    authorizationPath: stage.authorizationPath,
    resultDirectory: stage.resultDirectory,
    reconciliationReportPath: paths.reconciliationPath,
    outputPath: paths.bundlePath,
    write: true,
  });
  return { stage, source, reconciliationReport, paths };
}

describe("first-publication transition completion command", () => {
  it("completes through confirmed stage approval provenance without direct arming", async () => {
    const prepared = await stageApprovalCommandFixture();
    try {
      const receipt = await completeCliFirstPublicationTransition(
        {
          online: true,
          evidenceType: "stage_approval_reconciliation",
          publicationAuthorizationPath: prepared.paths.publicationAuthorizationPath,
          bootstrapPath: prepared.paths.bootstrapPath,
          workflowPath: prepared.paths.workflowPath,
          stageApprovalReviewPath: prepared.stage.stageReviewReportPath,
          stageApprovalDecisionPath: prepared.stage.decisionPath,
          stageApprovalAuthorizationPath: prepared.stage.authorizationPath,
          stageApprovalResultDirectory: prepared.stage.resultDirectory,
          stageApprovalReconciliationPath: prepared.paths.reconciliationPath,
        },
        {
          observePublicRelease: async () => matchingPublicObservation(prepared.source),
          observeNpm: async () => matchingNpmObservation(),
          observeGitHub: async () => matchingGitHubObservation(),
          clock: () => "2026-08-21T10:21:00Z",
        },
      );
      assert.equal(receipt.publicationEvidence.type, "stage_approval_reconciliation");
      assert.equal(receipt.schemaVersion, 3);
      assert.equal(receipt.publicationEvidence.basis, "npm_stage_approval_reconciliation_verified");
      await writeFirstPublicationTransitionReceipt(prepared.paths.outputPath, receipt);
      assert.equal(
        JSON.parse(await readFile(prepared.paths.outputPath, "utf8")).status,
        "completed",
      );
    } finally {
      await rm(prepared.stage.root, { recursive: true, force: true });
    }
  });

  it("completes from one stage evidence bundle and rechecks the manifest", async () => {
    const prepared = await stageApprovalCommandFixture();
    try {
      const options = {
        online: true,
        evidenceType: "stage_approval_reconciliation",
        publicationAuthorizationPath: prepared.paths.publicationAuthorizationPath,
        bootstrapPath: prepared.paths.bootstrapPath,
        workflowPath: prepared.paths.workflowPath,
        stageApprovalBundlePath: prepared.paths.bundlePath,
      };
      const receipt = await completeCliFirstPublicationTransition(options, {
        observePublicRelease: async () => matchingPublicObservation(prepared.source),
        observeNpm: async () => matchingNpmObservation(),
        observeGitHub: async () => matchingGitHubObservation(),
        clock: () => "2026-08-21T10:21:00Z",
      });
      assert.equal(receipt.schemaVersion, 3);
      assert.equal(receipt.publicationEvidence.type, "stage_approval_reconciliation");

      await assert.rejects(
        completeCliFirstPublicationTransition(options, {
          observePublicRelease: async () => matchingPublicObservation(prepared.source),
          observeNpm: async () => {
            await writeFile(prepared.paths.bundlePath, "{}\n");
            return matchingNpmObservation();
          },
          observeGitHub: async () => matchingGitHubObservation(),
          clock: () => "2026-08-21T10:21:00Z",
        }),
        { code: "release_attestation_release_set_changed" },
      );
    } finally {
      await rm(prepared.stage.root, { recursive: true, force: true });
    }
  });

  it("writes one source-bound v2 receipt from an execution receipt", async () => {
    const prepared = await commandFixture();
    try {
      const receipt = await completeCliFirstPublicationTransition(
        options(prepared, "execution_receipt"),
        observers(prepared.source),
      );
      await writeFirstPublicationTransitionReceipt(prepared.paths.outputPath, receipt);
      const stored = JSON.parse(await readFile(prepared.paths.outputPath, "utf8"));
      assert.equal(stored.schemaVersion, 2);
      assert.equal(stored.status, "completed");
      assert.equal(stored.publicationEvidence.type, "execution_receipt");
      assert.equal(stored.transition.directPublish, "forbidden");
      const original = await readFile(prepared.paths.outputPath);
      await assert.rejects(
        writeFirstPublicationTransitionReceipt(prepared.paths.outputPath, receipt),
        { code: "first_publication_transition_output_exists" },
      );
      assert.deepEqual(await readFile(prepared.paths.outputPath), original);
      const promoted = structuredClone(receipt);
      promoted.transition.directPublish = "allowed";
      const { transitionReceiptDigest: _old, ...body } = promoted;
      promoted.transitionReceiptDigest = canonicalDigest(body);
      await assert.rejects(
        writeFirstPublicationTransitionReceipt(resolve(prepared.root, "promoted.json"), promoted),
        { code: "first_publication_transition_receipt_invalid" },
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("uses the full reviewed source set without changing unknown storage", async () => {
    const prepared = await commandFixture();
    try {
      const before = await prepared.store.inspect(prepared.documents.reservation.reservationId);
      const receipt = await completeCliFirstPublicationTransition(
        options(prepared, "reconciliation_resolution"),
        observers(prepared.source),
      );
      assert.equal(receipt.publicationEvidence.type, "reconciliation_resolution");
      assert.equal(receipt.publicationEvidence.basis, "public_registry_reconciliation_reviewed");
      assert.deepEqual(
        await prepared.store.inspect(prepared.documents.reservation.reservationId),
        before,
      );
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("runs all three online observations before the final source check", async () => {
    const prepared = await commandFixture();
    try {
      const sequence = [];
      const receipt = await completeCliFirstPublicationTransition(
        options(prepared, "execution_receipt"),
        observers(prepared.source, {
          observePublicRelease: async () => {
            sequence.push("public");
            return matchingPublicObservation(prepared.source);
          },
          observeNpm: async () => {
            sequence.push("npm");
            return matchingNpmObservation();
          },
          observeGitHub: async ({ repository }) => {
            assert.equal(repository, firstPublicationRepository);
            sequence.push("github");
            return matchingGitHubObservation();
          },
        }),
      );
      assert.deepEqual(sequence.sort(), ["github", "npm", "public"]);
      assert.equal(receipt.publicRelease.observedAt, "2026-08-21T03:04:00Z");
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects source changes during observation before any output is written", async () => {
    const prepared = await commandFixture();
    try {
      await assert.rejects(
        completeCliFirstPublicationTransition(
          options(prepared, "execution_receipt"),
          observers(prepared.source, {
            observeNpm: async () => {
              await writeFile(prepared.paths.workflowPath, "{}\n");
              return matchingNpmObservation();
            },
          }),
        ),
        { code: "release_attestation_release_set_changed" },
      );
      await assert.rejects(access(prepared.paths.outputPath), { code: "ENOENT" });
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("fails closed on incomplete external controls without writing a receipt", async () => {
    const prepared = await commandFixture();
    try {
      await assert.rejects(
        completeCliFirstPublicationTransition(
          options(prepared, "execution_receipt"),
          observers(prepared.source, {
            observeNpm: async () => ({
              schemaVersion: 1,
              source: "npm_trust",
              state: "unavailable",
              reason: "authentication_or_registry_unavailable",
            }),
          }),
        ),
        { code: "first_publication_transition_not_ready" },
      );
      await assert.rejects(access(prepared.paths.outputPath), { code: "ENOENT" });
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("requires online mode before opening any source", async () => {
    let reads = 0;
    await assert.rejects(
      completeCliFirstPublicationTransition(
        {
          online: false,
          evidenceType: "execution_receipt",
          publicationAuthorizationPath: "/publication.json",
          bootstrapPath: "/bootstrap.json",
          armingAuthorizationPath: "/arming.json",
          workflowPath: "/workflow.yml",
          executionReceiptPath: "/execution.json",
        },
        {
          readSources: async () => {
            reads += 1;
          },
        },
      ),
      {
        code: "first_publication_transition_online_required",
      },
    );
    assert.equal(reads, 0);
  });

  it("rejects mixed evidence options before opening any source", async () => {
    let reads = 0;
    await assert.rejects(
      completeCliFirstPublicationTransition(
        {
          online: true,
          evidenceType: "execution_receipt",
          publicationAuthorizationPath: "/publication.json",
          bootstrapPath: "/bootstrap.json",
          armingAuthorizationPath: "/arming.json",
          workflowPath: "/workflow.yml",
          executionReceiptPath: "/execution.json",
          resolutionPath: "/resolution.json",
        },
        {
          readSources: async () => {
            reads += 1;
          },
        },
      ),
      {
        code: "first_publication_transition_input_invalid",
      },
    );
    assert.equal(reads, 0);
  });

  it("rejects an oversized workflow snapshot before starting online observers", async () => {
    const prepared = await commandFixture();
    try {
      await writeFile(prepared.paths.workflowPath, "x".repeat(256 * 1024 + 1));
      let observations = 0;
      const unexpected = async () => {
        observations += 1;
        return {};
      };
      await assert.rejects(
        completeCliFirstPublicationTransition(options(prepared, "execution_receipt"), {
          observePublicRelease: unexpected,
          observeNpm: unexpected,
          observeGitHub: unexpected,
        }),
        { code: "first_publication_transition_source_invalid" },
      );
      assert.equal(observations, 0);
    } finally {
      await rm(prepared.root, { recursive: true, force: true });
    }
  });

  it("rejects mixed, partial, duplicate, relative, and offline CLI arguments", () => {
    const common = [
      "--publication-authorization",
      "/publication.json",
      "--bootstrap",
      "/bootstrap.json",
      "--arming-authorization",
      "/arming.json",
      "--workflow",
      "/workflow.yml",
      "--output",
      "/transition.json",
    ];
    const resolution = [
      "--reservation-root",
      "/reservations",
      "--reconciliation-report",
      "/report.json",
      "--decision",
      "/decision.json",
      "--resolution",
      "/resolution.json",
    ];
    const stageApproval = [
      "--stage-approval-review",
      "/stage-review.json",
      "--stage-approval-decision",
      "/stage-decision.json",
      "--stage-approval-authorization",
      "/stage-authorization.json",
      "--stage-approval-result-directory",
      "/stage-result",
      "--stage-approval-reconciliation",
      "/stage-reconciliation.json",
    ];
    const stageCommon = common.filter(
      (value) => value !== "--arming-authorization" && value !== "/arming.json",
    );
    for (const args of [
      [...common, "--execution-receipt", "/execution.json"],
      [...common, "--online", "--execution-receipt", "/execution.json", ...resolution],
      [...common, "--online", ...resolution.slice(0, -2)],
      [...common, "--online", "--execution-receipt", "execution.json"],
      [...common, "--online", "--online", "--execution-receipt", "/execution.json"],
      [...common, "--online", "--execution-receipt", "/execution.json", ...stageApproval],
      [...stageCommon, "--online", ...stageApproval.slice(0, -2)],
      [
        ...stageCommon,
        "--online",
        ...stageApproval,
        "--stage-approval-bundle",
        "/stage-bundle.json",
      ],
      [...stageCommon, "--online", "--stage-approval-bundle", "stage-bundle.json"],
      [...common, "--online", "--stage-approval-bundle", "/stage-bundle.json"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/release/first-publication/transition/commands/complete-cli-first-publication-transition.mjs",
          ...args,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /^first_publication_transition_arguments_invalid:/u);
    }
  });
});
