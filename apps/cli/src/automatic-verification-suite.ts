import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const UNVERSIONED_DEFAULT_SUITE_ID = "repository.default";
const VERSIONED_DEFAULT_SUITE_ID = /^repository\.default\.v([1-9][0-9]*)$/u;
const SAFE_SUITE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

function automaticSuiteError(code: string, message: string, options?: ErrorOptions): Error {
  return Object.assign(new Error(message, options), { code });
}

function compareDecimalVersions(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function selectAutomaticVerificationSuite(suiteIds: readonly string[]): string {
  const uniqueSuiteIds = [...new Set(suiteIds)];
  const versionedDefaults = uniqueSuiteIds.flatMap((suiteId) => {
    const version = VERSIONED_DEFAULT_SUITE_ID.exec(suiteId)?.[1];
    return version === undefined ? [] : [{ suiteId, version }];
  });
  if (versionedDefaults.length > 0) {
    versionedDefaults.sort((left, right) => compareDecimalVersions(right.version, left.version));
    return versionedDefaults[0]!.suiteId;
  }
  if (uniqueSuiteIds.includes(UNVERSIONED_DEFAULT_SUITE_ID)) {
    return UNVERSIONED_DEFAULT_SUITE_ID;
  }
  const nonPilot = uniqueSuiteIds.filter((suiteId) => !suiteId.startsWith("lervo.pilot."));
  if (nonPilot.length === 1) return nonPilot[0]!;
  throw automaticSuiteError(
    "deliberation_verification_ambiguous",
    "Automatic deliberation requires a versioned repository.default.vN suite, repository.default, or exactly one non-pilot suite.",
  );
}

export async function resolveAutomaticVerificationSuite(repositoryRoot: string): Promise<string> {
  let entries;
  try {
    entries = await readdir(resolve(repositoryRoot, ".lervo/verifications"), {
      withFileTypes: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw automaticSuiteError(
      "deliberation_verification_unconfigured",
      "Automatic deliberation has no configured verification suite. Add a .lervo/verifications/repository.default.vN.yaml or repository.default.yaml suite, or pass an explicit configured suite; provider execution has not started.",
      { cause: error },
    );
  }
  return selectAutomaticVerificationSuite(
    entries
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name.slice(0, -".yaml".length))
      .filter((suiteId) => SAFE_SUITE_ID.test(suiteId)),
  );
}
