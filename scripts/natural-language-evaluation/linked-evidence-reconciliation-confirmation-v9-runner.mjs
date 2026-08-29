import { delegatedRetrievalDigest } from "./delegated-retrieval-contract.mjs";
import {
  linkedEvidenceReconciliationConfirmationV9SuiteId,
  normalizeLinkedEvidenceReconciliationConfirmationV9Suite,
  validateLinkedEvidenceReconciliationConfirmationV9Suite,
} from "./linked-evidence-reconciliation-confirmation-v9-contract.mjs";
import { runLinkedEvidenceReconciliationV8Benchmark } from "./linked-evidence-reconciliation-v8-runner.mjs";

export async function runLinkedEvidenceReconciliationConfirmationV9Benchmark(input) {
  const suite = validateLinkedEvidenceReconciliationConfirmationV9Suite(input.suite);
  const report = await runLinkedEvidenceReconciliationV8Benchmark({
    ...input,
    suite: normalizeLinkedEvidenceReconciliationConfirmationV9Suite(suite),
  });
  return {
    ...report,
    reportKind: "linked_evidence_reconciliation_confirmation_v9_observation",
    suiteId: linkedEvidenceReconciliationConfirmationV9SuiteId,
    suiteDigest: delegatedRetrievalDigest(suite),
    confirmation: {
      ...suite.confirmation,
      executionImplementation: "linked_evidence_reconciliation_v8_unchanged",
      observationsCombined: false,
    },
    policy: {
      ...report.policy,
      policyId: "linked-evidence-reconciliation-confirmation-v9",
      confirmationOfPolicyId: "linked-evidence-reconciliation-v8",
    },
  };
}
