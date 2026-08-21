import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { observeGitHubWorkflowSource, validateRemoteWorkflowSourceCommit } from
  "./github-workflow-source-observer.mjs";
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
import { validateReadinessRepository } from "./trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

async function inspectClear(inspectTransaction, transactionRoot) {
  let state;
  try {
    state = await inspectTransaction(transactionRoot);
  } catch (error) {
    if (error?.code ===
      "first_publication_workflow_activation_post_apply_transaction_invalid") {
      fail(
        "first_publication_workflow_remote_deployment_transaction_invalid",
        "Workflow 활성화 transaction 상태를 확인할 수 없습니다.",
      );
    }
    throw error;
  }
  if (state?.status !== "clear") {
    fail(
      "first_publication_workflow_remote_deployment_transaction_pending",
      "중단된 workflow 활성화 transaction을 먼저 복구해야 합니다.",
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
      "CLI stage-only workflow 원격 배포 증거에는 온라인 확인이 필요합니다.",
    );
  }
  try {
    validateReadinessRepository(repository);
    validateRemoteWorkflowSourceCommit(sourceCommit);
  } catch {
    fail(
      "first_publication_workflow_remote_deployment_input_invalid",
      "CLI stage-only workflow 원격 배포 증거 입력이 올바르지 않습니다.",
    );
  }
  const transactionRoot = dependencies.transactionRoot ??
    firstPublicationWorkflowActivationTransactionRoot;
  const inspectTransaction = dependencies.inspectTransaction ??
    inspectFirstPublicationWorkflowActivationTransactionState;
  await inspectClear(inspectTransaction, transactionRoot);
  const paths = dependencies.paths ?? firstPublicationWorkflowRemoteDeploymentPaths;
  const readSources = dependencies.readSources ??
    readFirstPublicationWorkflowRemoteDeploymentSources;
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
