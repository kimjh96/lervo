import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const defaultPhaseAPilotContractPath =
  "benchmarks/search/linked-evidence-shadow-phase-a-pilot.json";

export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function valueDigest(value) {
  return sha256(stableJson(value));
}

function reviewedContractBounds(contract) {
  if (
    contract.schemaVersion === 1 &&
    contract.managedRun?.maximumProviderTaskCalls === 30 &&
    contract.retention?.maximumPilots === 1
  ) {
    return true;
  }
  if (
    contract.schemaVersion === 2 &&
    contract.managedRun?.maximumPrimaryTaskCalls === 30 &&
    contract.managedRun?.maximumSemanticPublicationCalls === 30 &&
    contract.managedRun?.maximumProviderInvocations === 60 &&
    contract.eligibility?.requiredRunEvent === "run.completed" &&
    contract.eligibility?.requiredVerificationStatus === "passed" &&
    contract.eligibility?.writingPublicationDisposition === "record_only" &&
    contract.eligibility?.requiredSemanticEvaluationStatus === "completed" &&
    contract.retention?.maximumPilots === 2 &&
    contract.retention?.maximumActivePilots === 1
  ) {
    return true;
  }
  return (
    contract.schemaVersion === 3 &&
    contract.decisionId === "ADR-0252" &&
    contract.managedRun?.maximumPrimaryTaskCalls === 30 &&
    contract.managedRun?.maximumSemanticPublicationCalls === 30 &&
    contract.managedRun?.maximumProviderInvocations === 60 &&
    contract.eligibility?.requiredRunEvent === "run.completed" &&
    contract.eligibility?.requiredVerificationStatus === "passed" &&
    contract.eligibility?.writingPublicationDisposition === "record_only" &&
    contract.eligibility?.requiredSemanticEvaluationStatus === "completed" &&
    contract.retention?.maximumPilots === 3 &&
    contract.retention?.maximumActivePilots === 1
  );
}

function resolveContractPath(repositoryRoot, requestedPath) {
  if (isAbsolute(requestedPath)) {
    throw new Error("The phase-A pilot contract path must be repository-relative.");
  }
  const contractPath = resolve(repositoryRoot, requestedPath);
  if (relative(repositoryRoot, contractPath).startsWith("..")) {
    throw new Error("The phase-A pilot contract path escapes the repository.");
  }
  return contractPath;
}

export async function loadPhaseAPilotContract(
  repositoryRoot,
  requestedPath = defaultPhaseAPilotContractPath,
) {
  const contractPath = resolveContractPath(repositoryRoot, requestedPath);
  const bytes = await readFile(contractPath);
  const contract = JSON.parse(bytes.toString("utf8"));
  if (
    contract.provider !== "codex" ||
    contract.schedule?.expectedRunCount !== 30 ||
    contract.shadowGate?.minimumEligibleRuns !== 30 ||
    !reviewedContractBounds(contract)
  ) {
    throw new Error("The phase-A pilot contract differs from the reviewed bounds.");
  }
  const suitePath = resolve(repositoryRoot, contract.sourceSuitePath);
  const suiteBytes = await readFile(suitePath);
  if (sha256(suiteBytes) !== contract.sourceSuiteDigest) {
    throw new Error("The phase-A pilot source suite digest changed.");
  }
  const suite = JSON.parse(suiteBytes.toString("utf8"));
  return {
    contract,
    contractDigest: sha256(bytes),
    contractPath,
    suite: {
      ...suite,
      corpusExclusions: [...suite.corpusExclusions, ...contract.additionalCorpusExclusions],
    },
  };
}

export function createPhaseAPilotSchedule(contract, suite) {
  const runs = [];
  for (
    let repetition = 1;
    repetition <= contract.schedule.ordinaryRepetitionsPerCase;
    repetition += 1
  ) {
    for (const item of suite.cases)
      runs.push({ caseId: item.caseId, repetition, query: item.query });
  }
  for (const item of suite.cases) {
    if (item.lexicalExpectation === contract.schedule.additionalRepetitionsForExpectation) {
      runs.push({
        caseId: item.caseId,
        repetition: contract.schedule.ordinaryRepetitionsPerCase + 1,
        query: item.query,
      });
    }
  }
  if (runs.length !== contract.schedule.expectedRunCount) {
    throw new Error("The phase-A pilot schedule does not contain exactly 30 runs.");
  }
  return runs.map((run, index) => ({
    ...run,
    ordinal: index + 1,
    targetPath: `${contract.managedRun.targetPathPrefix}${String(index + 1).padStart(2, "0")}.md`,
    verificationSuiteId: `${contract.managedRun.verificationSuitePrefix}${String(index + 1).padStart(2, "0")}`,
  }));
}
