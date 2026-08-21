import { resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationStageApprovalReconciliationReport,
  validateFirstPublicationStageApprovalReconciliationReport,
} from "./first-publication-stage-approval-reconciliation.mjs";
import { readFirstPublicationStageApprovalReconciliationSources } from
  "./first-publication-stage-approval-reconciliation-sources.mjs";
import { repositoryRoot } from "./installed-cli.mjs";
import { observeNpmStageApprovalReconciliation } from
  "./npm-stage-approval-reconciliation-observer.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

function assertCoordinates(report, input) {
  const target = report.target;
  if (
    target.repository !== input.repository || target.sourceCommit !== input.sourceCommit ||
    target.releaseTag !== input.releaseTag || target.runId !== input.runId ||
    target.attempt !== input.attempt
  ) fail(
    "first_publication_stage_approval_reconciliation_source_mismatch",
    "npm stage 승인 결과 대조 좌표와 검토 증거가 일치하지 않습니다.",
  );
}

export async function reconcileCliFirstPublicationStageApproval(input, dependencies = {}) {
  if (input.online !== true) fail(
    "first_publication_stage_approval_reconciliation_online_required",
    "npm stage 승인 결과 대조에는 online 관측이 필요합니다.",
  );
  const readSources = dependencies.readSources ??
    readFirstPublicationStageApprovalReconciliationSources;
  const sources = await readSources(input, dependencies);
  assertCoordinates(sources.stageReviewReport, input);
  const observe = dependencies.observe ?? observeNpmStageApprovalReconciliation;
  const observation = await observe({
    registry: sources.attempt.stage.registry,
    packageName: sources.attempt.target.package,
    version: sources.attempt.target.version,
    distTag: sources.attempt.stage.distTag,
    expectedStageIdDigest: sources.attempt.stage.idDigest,
    userConfigPath: input.npmUserConfigPath,
  }, {
    npmCommand: dependencies.npmCommand ?? resolve(
      repositoryRoot,
      process.platform === "win32" ? "node_modules/.bin/npm.cmd" : "node_modules/.bin/npm",
    ),
    ...(dependencies.observerDependencies ?? {}),
  });
  if (observation?.state !== "observed") fail(
    "first_publication_stage_approval_reconciliation_not_ready",
    "npm stage 승인 결과를 관측하지 못했습니다.",
  );
  const observedAt = (dependencies.clock ?? (() => new Date().toISOString()))();
  const evidence = { ...sources, observation, observedAt };
  const report = createFirstPublicationStageApprovalReconciliationReport(evidence);
  validateFirstPublicationStageApprovalReconciliationReport(report, evidence);
  await sources.assertUnchanged();
  return report;
}
