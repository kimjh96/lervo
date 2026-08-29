import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { linkedEvidenceReconciliationV8SelectionProtocolDigest } from "./linked-evidence-reconciliation-v8-contract.mjs";
import { stableJson, valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";

export const authorizedProviderShadowContractDigest =
  "sha256:9e320dcec083bb9776eb110e9bcb5bea8db304c5eea78c3640482335d974085e";

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

export async function loadProviderShadowContract(
  repositoryRoot,
  contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v1.json",
) {
  const absoluteContractPath = resolve(repositoryRoot, contractPath);
  const contractBytes = await readFile(absoluteContractPath);
  const contractDigest = sha256(contractBytes);
  assert(
    contractDigest === authorizedProviderShadowContractDigest,
    "The provider-shadow contract differs from the exact user-authorized bytes.",
  );
  const contract = JSON.parse(contractBytes.toString("utf8"));
  const suitePath = resolve(repositoryRoot, contract.groundTruth.sourceSuitePath);
  const suiteBytes = await readFile(suitePath);
  const suite = JSON.parse(suiteBytes.toString("utf8"));
  const eligibleCases = suite.cases.filter(
    (item) => item.lexicalExpectation === contract.groundTruth.eligibleLexicalExpectation,
  );
  assert(contract.schemaVersion === 1, "The provider-shadow schema version is invalid.");
  assert(contract.decisionId === "ADR-0253", "The provider-shadow decision is invalid.");
  assert(
    contract.authorization.status === "design_only" &&
      contract.authorization.providerCallsAuthorized === false &&
      contract.authorization.managedContextEffectsAuthorized === false &&
      contract.authorization.canaryAuthorized === false &&
      contract.authorization.productionActivationAuthorized === false,
    "The provider-shadow contract must remain effect-free and authority-neutral.",
  );
  assert(
    sha256(suiteBytes) === contract.groundTruth.sourceSuiteDigest,
    "The provider-shadow source suite digest changed.",
  );
  assert(
    contract.selectionProtocol.protocolDigest ===
      linkedEvidenceReconciliationV8SelectionProtocolDigest,
    "The provider-shadow selection protocol digest changed.",
  );
  assert(eligibleCases.length === 6, "The provider-shadow case population is invalid.");
  assert(
    eligibleCases.length * contract.sourcePopulation.expectedRepetitionsPerCase ===
      contract.sourcePopulation.expectedShadowSampleCount,
    "The provider-shadow sample population is invalid.",
  );
  assert(
    contract.provider.maximumProviderInvocations === 24 &&
      contract.provider.maximumAttemptsPerSample === 1 &&
      contract.provider.maximumRetries === 0 &&
      contract.provider.maximumReplacementSamples === 0 &&
      contract.provider.maximumRepairTurns === 0 &&
      contract.provider.maximumAnswerTurns === 0 &&
      contract.provider.maximumSemanticPublicationCalls === 0,
    "The provider-shadow provider budget is invalid.",
  );
  assert(
    contract.candidateEnvelope.expectedMaximumCandidateSources === 16 &&
      contract.candidateEnvelope.expectedMaximumProviderVisibleSourceBytes === 130_302 &&
      contract.candidateEnvelope.maximumProviderVisibleSourceBytesPerCall === 262_144,
    "The provider-shadow candidate envelope bounds are invalid.",
  );
  assert(
    contract.observation.maximumPilots === 1 &&
      contract.observation.maximumActivePilots === 1 &&
      contract.observation.maximumObservations === 24,
    "The provider-shadow retention contract is invalid.",
  );
  return {
    contract,
    contractPath,
    contractDigest,
    suite,
    suiteBytes,
    eligibleCases,
  };
}

export { stableJson, valueDigest };
