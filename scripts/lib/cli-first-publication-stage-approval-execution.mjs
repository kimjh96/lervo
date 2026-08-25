import { resolve } from "node:path";

import { createFileFirstPublicationStageApprovalStore } from "./file-first-publication-stage-approval-store.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationStageApprovalAuthorization } from "./first-publication-stage-approval-authorization.mjs";
import { executeFirstPublicationStageApproval } from "./first-publication-stage-approval-execution.mjs";
import { readFirstPublicationStageApprovalExecutionSources } from "./first-publication-stage-approval-sources.mjs";
import { validateFirstPublicationStageReviewReportDocument } from "./first-publication-stage-review-report.mjs";
import { repositoryRoot } from "./installed-cli.mjs";
import { prepareNpmInteractiveStageApproval } from "./npm-interactive-stage-approval.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

function assertCoordinates(report, input) {
  const target = report.target;
  if (
    target.repository !== input.repository ||
    target.sourceCommit !== input.sourceCommit ||
    target.releaseTag !== input.releaseTag ||
    target.runId !== input.runId ||
    target.attempt !== input.attempt
  )
    fail(
      "first_publication_stage_approval_execution_source_mismatch",
      "The npm stage approval execution coordinates do not match the review evidence.",
    );
}

export async function executeCliFirstPublicationStageApproval(input, dependencies = {}) {
  if (input.online !== true || input.write !== true)
    fail(
      "first_publication_stage_approval_execution_authority_required",
      "npm stage approval execution requires explicit online and write authority.",
    );
  const readSources = dependencies.readSources ?? readFirstPublicationStageApprovalExecutionSources;
  const sources = await readSources(
    input.stageReviewReportPath,
    input.decisionPath,
    input.authorizationPath,
  );
  validateFirstPublicationStageReviewReportDocument(sources.stageReviewReport);
  assertCoordinates(sources.stageReviewReport, input);
  const authorizationInput = {
    stageReviewReport: sources.stageReviewReport,
    decision: sources.decision,
    authorizedAt: sources.authorization?.validity?.authorizedAt,
  };
  const validateAuthorization = (checkedAt) =>
    validateFirstPublicationStageApprovalAuthorization(sources.authorization, authorizationInput, {
      checkedAt,
    });
  const store =
    dependencies.store ??
    createFileFirstPublicationStageApprovalStore({
      rootDirectory: input.resultDirectory,
    });
  const prepareApproval =
    dependencies.prepareApproval ??
    (() =>
      prepareNpmInteractiveStageApproval(
        {
          registry: sources.stageReviewReport.npm.registry,
          packageName: sources.stageReviewReport.target.package,
          version: sources.stageReviewReport.target.version,
          expectedStage: sources.stageReviewReport.npm.stage,
          userConfigPath: input.npmUserConfigPath,
        },
        {
          npmCommand:
            dependencies.npmCommand ??
            resolve(
              repositoryRoot,
              process.platform === "win32" ? "node_modules/.bin/npm.cmd" : "node_modules/.bin/npm",
            ),
          ...(dependencies.adapterDependencies ?? {}),
        },
      ));
  return executeFirstPublicationStageApproval(
    {
      authorization: sources.authorization,
      validateAuthorization,
      assertUnchanged: sources.assertUnchanged,
    },
    {
      store,
      prepareApproval,
      clock: dependencies.clock,
    },
  );
}
