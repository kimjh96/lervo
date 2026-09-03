import { observeGitHubPublisherEnvironment } from "../adapters/github-environment-observer.mjs";
import { observeNpmTrustedPublisher } from "../adapters/npm-trust-observer.mjs";
import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import {
  firstPublicationWorkflowActivationPostApplyPaths,
  readFirstPublicationWorkflowActivationPostApplySources,
} from "./first-publication-workflow-activation-post-apply-sources.mjs";
import {
  assertFirstPublicationWorkflowActivationReceiptOutput,
  createFirstPublicationWorkflowActivationPostApplyReport,
  validateFirstPublicationWorkflowActivationPostApplyReport,
} from "./first-publication-workflow-activation-post-apply-verification.mjs";
import { validateFirstPublicationWorkflowActivationReceiptDocument } from "./first-publication-workflow-activation-receipt.mjs";
import {
  assertFirstPublicationWorkflowActivationTransactionClear,
  firstPublicationWorkflowActivationTransactionRoot,
  inspectFirstPublicationWorkflowActivationTransactionState,
} from "./first-publication-workflow-activation-transaction-state.mjs";
import { validateReadinessRepository } from "../../lib/trusted-publisher-readiness.mjs";

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function verifyCliFirstPublicationWorkflowActivationPostApply(
  { repository, receiptPath, online },
  dependencies = {},
) {
  if (online !== true) {
    fail(
      "first_publication_workflow_activation_post_apply_online_required",
      "CLI first-publication workflow activation post-apply verification requires online verification.",
    );
  }
  validateReadinessRepository(repository);
  const transactionRoot =
    dependencies.transactionRoot ?? firstPublicationWorkflowActivationTransactionRoot;
  const inspectTransaction =
    dependencies.inspectTransaction ?? inspectFirstPublicationWorkflowActivationTransactionState;
  assertFirstPublicationWorkflowActivationTransactionClear(
    await inspectTransaction(transactionRoot),
  );
  const paths = dependencies.paths ?? firstPublicationWorkflowActivationPostApplyPaths;
  const readSources =
    dependencies.readSources ?? readFirstPublicationWorkflowActivationPostApplySources;
  const sources = await readSources(paths, receiptPath);
  validateFirstPublicationWorkflowActivationReceiptDocument(sources.receipt);
  assertFirstPublicationWorkflowActivationReceiptOutput(
    sources.receipt,
    sources.sourceSnapshots.workflow,
  );
  const observeNpm = dependencies.observeNpm ?? observeNpmTrustedPublisher;
  const observeGitHub = dependencies.observeGitHub ?? observeGitHubPublisherEnvironment;
  const [npmObservation, githubObservation] = await Promise.all([
    observeNpm(),
    observeGitHub({ repository }),
  ]);
  const observedAt = (dependencies.clock ?? (() => new Date().toISOString()))();
  await sources.assertUnchanged();
  const transactionState = await inspectTransaction(transactionRoot);
  assertFirstPublicationWorkflowActivationTransactionClear(transactionState);
  const input = {
    ...sources,
    repository,
    npmObservation,
    githubObservation,
    observedAt,
    transactionState,
  };
  const report = createFirstPublicationWorkflowActivationPostApplyReport(input);
  return validateFirstPublicationWorkflowActivationPostApplyReport(report, input);
}
