import type { OutcomeSupervisionPorts } from "@lervo/orchestrator";
import {
  loadVerificationSuite,
  resolveVerificationWorkingDirectories,
  verificationSuiteHash,
} from "@lervo/verification";
import { operatingContractHash } from "@lervo/work-controller";
import type { NodeRuntimeReadinessConfiguration } from "./supervision-runtime-configuration.js";

type Readiness = Awaited<ReturnType<OutcomeSupervisionPorts["readWorkerReadiness"]>>;

/** Validates pinned definitions and working directories without running verification commands. */
export async function observeSupervisionVerificationReadiness(input: {
  repositoryRoot: string;
  readiness: Readiness;
  configuration: NodeRuntimeReadinessConfiguration | undefined;
  now(): string;
}): Promise<Readiness> {
  const readiness = structuredClone(input.readiness);
  const check = readiness.observation.checks.find((item) => item.kind === "verification");
  if (check?.status !== "passed" || check.evidenceHash === null) return readiness;
  const started = input.now();
  try {
    const ids = readiness.responsibility.verificationSuiteIds;
    const pins = input.configuration?.verificationSuiteHashes;
    if (
      pins === undefined ||
      ids.length === 0 ||
      ids.length > 32 ||
      ids.some((id) => !Object.hasOwn(pins, id))
    )
      throw new Error("Verification definitions are not pinned.");
    const observed = [];
    for (const suiteId of ids) {
      const suite = await loadVerificationSuite(input.repositoryRoot, suiteId);
      const suiteHash = verificationSuiteHash(suite);
      if (suiteHash !== pins[suiteId]) throw new Error("Verification definition changed.");
      await resolveVerificationWorkingDirectories(input.repositoryRoot, suite);
      const current = await loadVerificationSuite(input.repositoryRoot, suiteId);
      if (verificationSuiteHash(current) !== suiteHash)
        throw new Error("Verification definition changed during inspection.");
      observed.push({ suiteId, suiteHash });
    }
    const elapsed = Date.parse(input.now()) - Date.parse(started);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 5000)
      throw new Error("Verification inspection expired.");
    check.evidenceHash = operatingContractHash({ adapter: check.evidenceHash, suites: observed });
  } catch {
    check.status = "unobserved";
    check.evidenceHash = null;
  }
  return readiness;
}
