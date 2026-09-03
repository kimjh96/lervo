import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import {
  observeGitHubWorkflowSource,
  validateRemoteWorkflowSourceCommit,
} from "../adapters/github-workflow-source-observer.mjs";
import {
  assertFirstPublicationWorkflowRemoteLocalBinding,
  createFirstPublicationWorkflowRemoteDeploymentEvidence,
  validateFirstPublicationWorkflowRemoteDeploymentEvidence,
} from "./first-publication-workflow-remote-deployment-evidence.mjs";
import {
  firstPublicationWorkflowRemoteDeploymentPaths,
  readFirstPublicationWorkflowRemoteDeploymentSources,
} from "./first-publication-workflow-remote-deployment-sources.mjs";
import {
  firstPublicationWorkflowActivationTransactionRoot,
  inspectFirstPublicationWorkflowActivationTransactionState,
} from "./first-publication-workflow-activation-transaction-state.mjs";
import { validateReadinessRepository } from "../../lib/trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

async function inspectClear(inspectTransaction, transactionRoot) {
  let state;
  try {
    state = await inspectTransaction(transactionRoot);
  } catch (error) {
    if (error?.code === "first_publication_workflow_activation_post_apply_transaction_invalid") {
      fail(
        "first_publication_workflow_remote_deployment_transaction_invalid",
        "The workflow-activation transaction state could not be determined.",
      );
    }
    throw error;
  }
  if (state?.status !== "clear") {
    fail(
      "first_publication_workflow_remote_deployment_transaction_pending",
      "The interrupted workflow-activation transaction must be recovered first.",
    );
  }
  return state;
}

export async function createCliFirstPublicationWorkflowRemoteDeploymentEvidence(
  { repository, sourceCommit, postApplyReportPath, online },
  dependencies = {},
) {
  if (online !== true) {
    fail(
      "first_publication_workflow_remote_deployment_online_required",
      "CLI stage-only workflow remote-deployment evidence requires online verification.",
    );
  }
  try {
    validateReadinessRepository(repository);
    validateRemoteWorkflowSourceCommit(sourceCommit);
  } catch {
    fail(
      "first_publication_workflow_remote_deployment_input_invalid",
      "The CLI stage-only workflow remote-deployment evidence input is invalid.",
    );
  }
  const transactionRoot =
    dependencies.transactionRoot ?? firstPublicationWorkflowActivationTransactionRoot;
  const inspectTransaction =
    dependencies.inspectTransaction ?? inspectFirstPublicationWorkflowActivationTransactionState;
  await inspectClear(inspectTransaction, transactionRoot);
  const paths = dependencies.paths ?? firstPublicationWorkflowRemoteDeploymentPaths;
  const readSources =
    dependencies.readSources ?? readFirstPublicationWorkflowRemoteDeploymentSources;
  const sources = await readSources(paths, postApplyReportPath);
  const binding = {
    repository,
    sourceCommit,
    postApplyReport: sources.postApplyReport,
    workflowSnapshot: sources.workflowSnapshot,
  };
  assertFirstPublicationWorkflowRemoteLocalBinding(binding);
  const observeRemote = dependencies.observeRemote ?? observeGitHubWorkflowSource;
  const remoteObservation = await observeRemote({ repository, sourceCommit });
  const observedAt = (dependencies.clock ?? (() => new Date().toISOString()))();
  await sources.assertUnchanged();
  const transactionState = await inspectClear(inspectTransaction, transactionRoot);
  const input = { ...binding, remoteObservation, observedAt, transactionState };
  const evidence = createFirstPublicationWorkflowRemoteDeploymentEvidence(input);
  return validateFirstPublicationWorkflowRemoteDeploymentEvidence(evidence, input);
}
