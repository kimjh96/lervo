import { repositoryPassOrder } from "./host-follow-policy.js";
import type { ActiveCli } from "./host-follow-runtime.js";
import type { HostFollowPass, HostFollowState } from "./host-follow-state.js";

/**
 * Registered repositories the CLI the last pass ran still owes a run: those whose retry is due,
 * and those registered since that pass, such as a project the owner just added, in pass order.
 * A pass a host failure stopped owes the repositories after it nothing: they would run the same
 * broken CLI, so they wait for another one. A repository no longer registered is never retried.
 */
export function dueRepositories(
  state: HostFollowState,
  active: ActiveCli,
  now: Date,
  registered: readonly string[],
): string[] {
  const pass = state.lastPass;
  if (pass === null || pass.cliTarget !== active.target) return [];
  const passed = new Set(pass.repositories.map((repository) => repository.repositoryRoot));
  const due = new Set(
    pass.repositories
      .filter(
        (repository) =>
          repository.nextAttemptAt !== null && repository.nextAttemptAt <= now.toISOString(),
      )
      .map((repository) => repository.repositoryRoot),
  );
  const owed = registered.filter(
    (root) => due.has(root) || (pass.outcome !== "host_failure" && !passed.has(root)),
  );
  return repositoryPassOrder(owed, pass);
}

/**
 * The last pass's entries, each replaced by its new result, then the new results of repositories
 * it did not hold. Entries of repositories no longer registered are dropped, so the pass stays
 * bounded by the host registry.
 */
export function mergeRepositoryResults(
  previous: HostFollowPass["repositories"],
  results: HostFollowPass["repositories"],
  registered: readonly string[],
): HostFollowPass["repositories"] {
  const kept = previous.filter((repository) => registered.includes(repository.repositoryRoot));
  const keptRoots = new Set(kept.map((repository) => repository.repositoryRoot));
  return [
    ...kept.map(
      (repository) =>
        results.find((item) => item.repositoryRoot === repository.repositoryRoot) ?? repository,
    ),
    ...results.filter((item) => !keptRoots.has(item.repositoryRoot)),
  ];
}
