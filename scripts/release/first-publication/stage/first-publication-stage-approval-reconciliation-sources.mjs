import { isAbsolute } from "node:path";

import { createFileFirstPublicationStageApprovalStore } from "../adapters/file-first-publication-stage-approval-store.mjs";
import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { validateFirstPublicationStageApprovalAuthorization } from "./first-publication-stage-approval-authorization.mjs";
import {
  bindFirstPublicationStageApprovalTerminal,
  validateFirstPublicationStageApprovalAttempt,
} from "./first-publication-stage-approval-records.mjs";
import { readFirstPublicationStageApprovalExecutionSources } from "./first-publication-stage-approval-sources.mjs";
import { canonicalJson } from "../../../shared/release-artifact-manifest.mjs";

function fail(code = "first_publication_stage_approval_reconciliation_source_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI npm stage approval reconciliation source is invalid.",
  );
}

function validateSnapshot(snapshot, sources) {
  validateFirstPublicationStageApprovalAttempt(snapshot?.attempt);
  bindFirstPublicationStageApprovalTerminal(snapshot?.terminal, snapshot.attempt);
  if (
    !["approval_command_completed", "approval_outcome_unknown"].includes(snapshot.terminal.state) ||
    snapshot.attempt.authorizationDigest !== sources.authorization.authorizationDigest
  )
    fail();
  return snapshot;
}

export async function readFirstPublicationStageApprovalReconciliationSources(
  options,
  dependencies = {},
) {
  if (!isAbsolute(options?.resultDirectory ?? "")) fail();
  const readSources =
    dependencies.readExecutionSources ?? readFirstPublicationStageApprovalExecutionSources;
  const sources = await readSources(
    options.stageReviewReportPath,
    options.decisionPath,
    options.authorizationPath,
  );
  validateFirstPublicationStageApprovalAuthorization(sources.authorization, {
    stageReviewReport: sources.stageReviewReport,
    decision: sources.decision,
    authorizedAt: sources.authorization?.validity?.authorizedAt,
  });
  const createStore = dependencies.createStore ?? createFileFirstPublicationStageApprovalStore;
  const store = createStore({ rootDirectory: options.resultDirectory });
  let snapshot;
  try {
    snapshot = validateSnapshot(await store.inspect(), sources);
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
  return {
    ...sources,
    attempt: snapshot.attempt,
    terminal: snapshot.terminal,
    assertUnchanged: async () => {
      await sources.assertUnchanged();
      const current = validateSnapshot(await store.inspect(), sources);
      if (canonicalJson(current) !== canonicalJson(snapshot)) {
        fail("first_publication_stage_approval_reconciliation_source_changed");
      }
    },
  };
}
