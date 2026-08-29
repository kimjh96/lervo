import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { record } from "./contract-common.mjs";
import {
  buildLinkedEvidenceReconciliationV8Coverage,
  buildLinkedEvidenceReconciliationV8Expansion,
  buildLinkedEvidenceReconciliationV8NoHitCatalog,
  linkedEvidenceReconciliationV8ProtocolDigest,
  validateLinkedEvidenceReconciliationV8Recommendations,
  validateLinkedEvidenceReconciliationV8Suite,
} from "./linked-evidence-reconciliation-v8-contract.mjs";

export const linkedEvidenceReconciliationConfirmationV9SuiteId =
  "drbench_linked_evidence_reconciliation_confirmation_v9.v1";
const v8SuiteId = "drbench_linked_evidence_reconciliation_v8.v1";
const v8BenchmarkMode = "linked_evidence_reconciliation_v8_comparison";
const v8ProtocolId = "linked-evidence-reconciliation-v8";
const v8SuitePath = "benchmarks/search/linked-evidence-reconciliation-v8.json";
const v9DecisionPath = "docs/decisions/search/0247-confirm-linked-evidence-reconciliation-v9.md";
const confirmationContract = {
  kind: "exact_replication",
  candidateSuiteId: v8SuiteId,
  candidateProtocolId: v8ProtocolId,
  candidateProtocolDigest: linkedEvidenceReconciliationV8ProtocolDigest,
  priorObservationsReusable: false,
  reportsMayBeCombined: false,
};

export function normalizeLinkedEvidenceReconciliationConfirmationV9Suite(suite) {
  const { confirmation: _confirmation, ...shared } = suite;
  return {
    ...shared,
    suiteId: v8SuiteId,
    benchmarkMode: v8BenchmarkMode,
    protocolId: v8ProtocolId,
    corpusExclusions: suite.corpusExclusions.filter((item) => item !== v9DecisionPath),
  };
}

export function validateLinkedEvidenceReconciliationConfirmationV9Suite(value, repositoryRoot) {
  const suite = record(value, "linked evidence reconciliation confirmation v9 suite");
  if (
    suite.schemaVersion !== 1 ||
    suite.suiteId !== linkedEvidenceReconciliationConfirmationV9SuiteId ||
    suite.benchmarkMode !== "linked_evidence_reconciliation_confirmation_v9_comparison" ||
    suite.protocolId !== v8ProtocolId ||
    suite.protocolDigest !== linkedEvidenceReconciliationV8ProtocolDigest ||
    JSON.stringify(suite.confirmation) !== JSON.stringify(confirmationContract) ||
    suite.corpusExclusions.at(-1) !== v9DecisionPath
  ) {
    throw new TypeError("The linked evidence reconciliation confirmation v9 header is invalid.");
  }

  const normalized = normalizeLinkedEvidenceReconciliationConfirmationV9Suite(suite);
  validateLinkedEvidenceReconciliationV8Suite(normalized, repositoryRoot);
  if (repositoryRoot !== undefined) {
    const registeredV8 = JSON.parse(readFileSync(resolve(repositoryRoot, v8SuitePath), "utf8"));
    if (JSON.stringify(normalized) !== JSON.stringify(registeredV8)) {
      throw new TypeError("The v9 confirmation suite is not an exact normalized v8 replication.");
    }
  }
  return suite;
}

export {
  buildLinkedEvidenceReconciliationV8Coverage as buildLinkedEvidenceReconciliationConfirmationV9Coverage,
  buildLinkedEvidenceReconciliationV8Expansion as buildLinkedEvidenceReconciliationConfirmationV9Expansion,
  buildLinkedEvidenceReconciliationV8NoHitCatalog as buildLinkedEvidenceReconciliationConfirmationV9NoHitCatalog,
  linkedEvidenceReconciliationV8ProtocolDigest as linkedEvidenceReconciliationConfirmationV9ProtocolDigest,
  validateLinkedEvidenceReconciliationV8Recommendations as validateLinkedEvidenceReconciliationConfirmationV9Recommendations,
};
