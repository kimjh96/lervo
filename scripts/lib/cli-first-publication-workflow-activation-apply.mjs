import { observeGitHubPublisherEnvironment } from "./github-environment-observer.mjs";
import { observeNpmTrustedPublisher } from "./npm-trust-observer.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationWorkflowActivationDecision } from
  "./first-publication-workflow-activation-decision.mjs";
import {
  applyFirstPublicationWorkflowActivationFiles,
  assertNoFirstPublicationWorkflowActivationTransaction,
} from "./first-publication-workflow-activation-filesystem.mjs";
import {
  validateFirstPublicationWorkflowActivationPermit,
  validateReadyWorkflowActivationReadiness,
} from "./first-publication-workflow-activation-permit.mjs";
import { recoverFirstPublicationWorkflowActivationFiles } from
  "./first-publication-workflow-activation-recovery.mjs";
import {
  createFirstPublicationWorkflowActivationCandidate,
  validateFirstPublicationWorkflowActivationCandidate,
} from "./first-publication-workflow-activation-candidate.mjs";
import {
  firstPublicationWorkflowActivationPaths,
  readFirstPublicationWorkflowActivationApplySources,
} from "./first-publication-workflow-activation-permit-sources.mjs";
import {
  createFirstPublicationWorkflowActivationPlan,
  createFirstPublicationWorkflowActivationReceipt,
  validateFirstPublicationWorkflowActivationPlan,
  validateFirstPublicationWorkflowActivationReceipt,
} from "./first-publication-workflow-activation-transaction.mjs";
import { firstPublicationWorkflowActivationTransactionRoot } from
  "./first-publication-workflow-activation-transaction-state.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";
import {
  createTrustedPublisherReadinessReport,
  validateReadinessRepository,
} from "./trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function applyCliFirstPublicationWorkflowActivation(
  { repository, decisionPath, permitPath, online },
  dependencies = {},
) {
  if (online !== true) fail(
    "first_publication_workflow_activation_apply_online_required",
    "CLI 최초 게시 workflow 활성화 적용에는 온라인 재확인이 필요합니다.",
  );
  validateReadinessRepository(repository);
  const paths = dependencies.paths ?? firstPublicationWorkflowActivationPaths;
  const transactionRoot = dependencies.transactionRoot ??
    firstPublicationWorkflowActivationTransactionRoot;
  const assertNoTransaction = dependencies.assertNoTransaction ??
    assertNoFirstPublicationWorkflowActivationTransaction;
  await assertNoTransaction(transactionRoot);
  const readSources = dependencies.readSources ??
    readFirstPublicationWorkflowActivationApplySources;
  const sources = await readSources(paths, decisionPath, permitPath);
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const checkedAt = clock();
  validateFirstPublicationWorkflowActivationDecision(sources.decision, { checkedAt });
  const candidateInput = {
    packageManifest: sources.packageManifest,
    workflow: sources.workflow,
    packageSnapshot: sources.packageSnapshot,
    workflowSnapshot: sources.workflowSnapshot,
  };
  const candidateResult = createFirstPublicationWorkflowActivationCandidate(candidateInput);
  validateFirstPublicationWorkflowActivationCandidate(candidateResult, candidateInput);
  const permitInput = {
    candidateResult,
    candidateInput,
    decision: sources.decision,
    readinessReport: sources.permit?.readiness?.report,
    repository,
    packageManifest: sources.cliPackageManifest,
    workflow: sources.workflow,
    observedAt: sources.permit?.readiness?.observedAt,
  };
  validateFirstPublicationWorkflowActivationPermit(sources.permit, permitInput, { checkedAt });
  const observeNpm = dependencies.observeNpm ?? observeNpmTrustedPublisher;
  const observeGitHub = dependencies.observeGitHub ?? observeGitHubPublisherEnvironment;
  const [npmObservation, githubObservation] = await Promise.all([
    observeNpm(),
    observeGitHub({ repository }),
  ]);
  const recheckedAt = clock();
  validateFirstPublicationWorkflowActivationDecision(sources.decision, {
    checkedAt: recheckedAt,
  });
  validateFirstPublicationWorkflowActivationPermit(sources.permit, permitInput, {
    checkedAt: recheckedAt,
  });
  const currentReadiness = createTrustedPublisherReadinessReport({
    repository,
    packageManifest: sources.cliPackageManifest,
    workflow: sources.workflow,
    npmObservation,
    githubObservation,
  });
  validateReadyWorkflowActivationReadiness(currentReadiness, {
    repository,
    packageManifest: sources.cliPackageManifest,
    workflow: sources.workflow,
  });
  if (
    canonicalJson(currentReadiness) !== canonicalJson(sources.permit.readiness.report)
  ) fail(
    "first_publication_workflow_activation_controls_changed",
    "CLI 최초 게시 workflow 활성화 외부 보호 설정이 허가 뒤 달라졌습니다.",
  );
  await sources.assertUnchanged();
  const planInput = {
    permit: sources.permit,
    permitInput,
    sourceSnapshots: sources.sourceSnapshots,
    checkedAt: recheckedAt,
  };
  const planResult = createFirstPublicationWorkflowActivationPlan(planInput);
  validateFirstPublicationWorkflowActivationPlan(planResult, planInput);
  const applyFiles = dependencies.applyFiles ?? applyFirstPublicationWorkflowActivationFiles;
  const transaction = await applyFiles({
    transactionRoot,
    plan: planResult.plan,
    workflowFile: {
      path: paths.workflowPath,
      binding: planResult.plan.workflow,
      outputBytes: planResult.outputBytes,
    },
    readOnlyFiles: [
      { path: paths.packageManifestPath, binding: planResult.plan.readOnlySources[0] },
      { path: paths.cliPackageManifestPath, binding: planResult.plan.readOnlySources[1] },
      { path: decisionPath, binding: planResult.plan.readOnlySources[2] },
      { path: permitPath, binding: planResult.plan.readOnlySources[3] },
    ],
  }, dependencies);
  if (canonicalJson(transaction) !== canonicalJson({
    journal: "removed",
    rollback: "not_required",
    recovery: "not_required",
  })) fail(
    "first_publication_workflow_activation_apply_failed",
    "CLI 최초 게시 workflow 활성화 transaction 결과가 올바르지 않습니다.",
  );
  const receipt = createFirstPublicationWorkflowActivationReceipt(planResult.plan, clock());
  return validateFirstPublicationWorkflowActivationReceipt(receipt, planResult.plan);
}

export async function recoverCliFirstPublicationWorkflowActivation(dependencies = {}) {
  const paths = dependencies.paths ?? firstPublicationWorkflowActivationPaths;
  const transactionRoot = dependencies.transactionRoot ??
    firstPublicationWorkflowActivationTransactionRoot;
  const recover = dependencies.recoverFiles ?? recoverFirstPublicationWorkflowActivationFiles;
  return recover({ transactionRoot, workflowPath: paths.workflowPath });
}
