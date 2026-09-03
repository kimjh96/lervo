const RELATED_TEST_ARGUMENTS = [
  "exec",
  "vitest",
  "run",
  "--changed",
  "HEAD",
  "--passWithNoTests",
  "--pool=threads",
  "--maxWorkers=1",
  "--reporter=dot",
];

const FULL_TEST_ARGUMENTS = [
  "exec",
  "vitest",
  "run",
  "--pool=threads",
  "--maxWorkers=1",
  "--reporter=dot",
];

const ROOT_WORKSPACE_PATHS = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);

const ANALYZABLE_SOURCE_EXTENSION = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/u;
const PACKAGE_OR_APP_PATH = /^(?:apps|packages)\//u;
const PACKAGE_MANIFEST_PATH = /^(?:apps|packages)\/[^/]+\/package\.json$/u;
const ROOT_TEST_CONFIGURATION_PATH = /^(?:tsconfig(?:\.[^.]+)?\.json|vitest(?:\.workspace)?\..+)$/u;
const RUNTIME_DIRECTORY_PATH = /^(?:apps|packages)\/.*\/(?:assets|fixtures|templates)\//u;
const SCRIPT_TEST_PATH = /^scripts\/.*\/test\/.*\.test\.mjs$/u;
const WORKFLOW_PATH = /^\.github\/(?:actions|workflows)\//u;

function escalationReason(path) {
  if (
    ROOT_WORKSPACE_PATHS.has(path) ||
    ROOT_TEST_CONFIGURATION_PATH.test(path) ||
    PACKAGE_MANIFEST_PATH.test(path)
  )
    return "workspace_or_test_configuration";
  if (WORKFLOW_PATH.test(path)) return "workflow_runtime_definition";
  if (path.startsWith("scripts/") && !SCRIPT_TEST_PATH.test(path))
    return "repository_execution_script";
  if (RUNTIME_DIRECTORY_PATH.test(path)) return "runtime_loaded_asset_or_fixture";
  if (PACKAGE_OR_APP_PATH.test(path) && !ANALYZABLE_SOURCE_EXTENSION.test(path))
    return "runtime_loaded_non_source_file";
  return null;
}

function assertRepositoryPath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw new Error("Changed paths must be normalized repository-relative paths.");
  }
}

export function createChangedRuntimeVerificationPlan(changedPaths) {
  const normalizedPaths = [...new Set(changedPaths)].sort();
  const escalationTriggers = [];
  for (const path of normalizedPaths) {
    assertRepositoryPath(path);
    const reason = escalationReason(path);
    if (reason !== null) escalationTriggers.push({ path, reason });
  }

  const mode = escalationTriggers.length === 0 ? "related" : "full";
  return {
    mode,
    executable: "pnpm",
    arguments: [...(mode === "full" ? FULL_TEST_ARGUMENTS : RELATED_TEST_ARGUMENTS)],
    changedPathCount: normalizedPaths.length,
    escalationTriggers,
  };
}
