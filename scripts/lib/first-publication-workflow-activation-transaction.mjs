import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationWorkflowActivationPermit } from
  "./first-publication-workflow-activation-permit.mjs";
import { validateFirstPublicationWorkflowActivationReceiptDocument } from
  "./first-publication-workflow-activation-receipt.mjs";
import { canonicalDigest, canonicalJson, sha256 } from
  "./release-artifact-manifest.mjs";

function fail(code = "first_publication_workflow_activation_plan_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication workflow activation apply plan is invalid.",
  );
}

function binding(id, relativePath, snapshot) {
  if (
    !Buffer.isBuffer(snapshot?.contents) || snapshot.contents.length < 1 ||
    snapshot.byteCount !== snapshot.contents.length ||
    snapshot.sha256 !== sha256(snapshot.contents)
  ) fail();
  return {
    id,
    relativePath,
    byteCount: snapshot.byteCount,
    sha256: snapshot.sha256,
  };
}

function planBody(plan) {
  const body = structuredClone(plan);
  delete body.planDigest;
  return body;
}

export function createFirstPublicationWorkflowActivationPlan({
  permit,
  permitInput,
  sourceSnapshots,
  checkedAt,
}) {
  validateFirstPublicationWorkflowActivationPermit(permit, permitInput, { checkedAt });
  const outputBytes = permitInput.candidateResult.outputBytes;
  const workflowSource = permitInput.candidateInput.workflowSnapshot;
  if (
    !Buffer.isBuffer(outputBytes) || outputBytes.length < 1 ||
    permit.readiness.report.readinessDigest !== permitInput.readinessReport.readinessDigest
  ) fail();
  const body = {
    schemaVersion: 1,
    status: "ready_to_apply",
    transactionType: "first_publication_stage_only_workflow_activation",
    permitDigest: permit.permitDigest,
    decisionDigest: permit.decision.decisionDigest,
    readinessDigest: permit.readiness.report.readinessDigest,
    controlsRecheckedAt: checkedAt,
    workflow: {
      id: "releaseWorkflow",
      relativePath: ".github/workflows/cli-release-matrix.yml",
      before: {
        byteCount: workflowSource.byteCount,
        sha256: workflowSource.sha256,
      },
      after: {
        byteCount: outputBytes.length,
        sha256: sha256(outputBytes),
      },
    },
    readOnlySources: [
      binding("rootPackage", "package.json", permitInput.candidateInput.packageSnapshot),
      binding("cliPackage", "apps/cli/package.json", sourceSnapshots.cliPackage),
      binding("decision", "operator decision", sourceSnapshots.decision),
      binding("permit", "activation permit", sourceSnapshots.permit),
    ],
    strategy: {
      compareAndSwap: "all_sources_before_first_write",
      publication: "single_file_staged_replace_with_recovery_journal",
      synchronousFailure: "rollback_original_workflow",
      interruptedProcess: "explicit_recovery_required",
    },
    externalEffects: {
      npmSettings: "observed_not_changed",
      githubSettings: "observed_not_changed",
      publication: "not_attempted",
    },
  };
  return {
    plan: { ...body, planDigest: canonicalDigest(body) },
    outputBytes: Buffer.from(outputBytes),
  };
}

export function validateFirstPublicationWorkflowActivationPlan(result, input) {
  const expected = createFirstPublicationWorkflowActivationPlan(input);
  if (
    canonicalJson(result?.plan) !== canonicalJson(expected.plan) ||
    !Buffer.isBuffer(result?.outputBytes) ||
    !result.outputBytes.equals(expected.outputBytes)
  ) fail();
  return result;
}

export function createFirstPublicationWorkflowActivationReceipt(plan, appliedAt) {
  if (
    plan?.status !== "ready_to_apply" ||
    plan.transactionType !== "first_publication_stage_only_workflow_activation" ||
    plan.planDigest !== canonicalDigest(planBody(plan)) ||
    !Number.isFinite(Date.parse(appliedAt ?? ""))
  ) fail("first_publication_workflow_activation_receipt_invalid");
  const body = {
    schemaVersion: 1,
    status: "applied",
    receiptType: "first_publication_stage_only_workflow_activation",
    planDigest: plan.planDigest,
    permitDigest: plan.permitDigest,
    readinessDigest: plan.readinessDigest,
    controlsRecheckedAt: plan.controlsRecheckedAt,
    workflow: structuredClone(plan.workflow.after),
    appliedAt,
    activation: "stage_only_workflow_active",
    externalSettings: "observed_not_changed",
    publication: "not_attempted",
  };
  return { ...body, receiptDigest: canonicalDigest(body) };
}

export function validateFirstPublicationWorkflowActivationReceipt(receipt, plan) {
  validateFirstPublicationWorkflowActivationReceiptDocument(receipt);
  const expected = createFirstPublicationWorkflowActivationReceipt(plan, receipt?.appliedAt);
  if (canonicalJson(receipt) !== canonicalJson(expected)) {
    fail("first_publication_workflow_activation_receipt_invalid");
  }
  return receipt;
}
