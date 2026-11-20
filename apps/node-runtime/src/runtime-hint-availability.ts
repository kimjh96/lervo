import { repositoryWatchReporter } from "@lervo/repository-knowledge-runtime";

/**
 * ADR-0602: records a failing Hub hint wait as `hub_runtime_changes_unavailable` attention for as
 * long as it fails, and clears it at the next answer. Without a repository root it records nothing.
 */
export function runtimeHintAvailability(
  repositoryRoot: string | undefined,
): ((failure: unknown) => void) | undefined {
  if (repositoryRoot === undefined) return undefined;
  const reporter = repositoryWatchReporter(repositoryRoot, "hub_runtime_changes_unavailable");
  let write: Promise<void> = Promise.resolve();
  return (failure) => {
    write = write.then(() => (failure === null ? reporter.armed() : reporter.failed(failure)));
  };
}
