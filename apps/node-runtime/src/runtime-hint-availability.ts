import { repositoryWatchReporter } from "@lervo/repository-knowledge-runtime";

/**
 * ADR-0602: records a failing Hub hint wait as `hub_runtime_changes_unavailable` attention for as
 * long as it fails, and a Hub too old for the open hold as `hub_upgrade_required` until an open
 * hold is answered; both clear then. Without a repository root it records nothing.
 */
export function runtimeHintAvailability(
  repositoryRoot: string | undefined,
): ((failure: unknown) => void) | undefined {
  if (repositoryRoot === undefined) return undefined;
  const reporter = repositoryWatchReporter(repositoryRoot, "hub_runtime_changes_unavailable");
  // ADR-0602: a Hub too old for the open hold has its own remedy, deploying the Hub first.
  const upgrade = repositoryWatchReporter(repositoryRoot, "hub_upgrade_required");
  let write: Promise<void> = Promise.resolve();
  return (failure) => {
    const outdated = (failure as { code?: unknown } | null)?.code === "hub_upgrade_required";
    write = write.then(async () => {
      if (failure === null) {
        await reporter.armed();
        await upgrade.armed();
      } else if (outdated) {
        await reporter.armed();
        await upgrade.failed(failure);
      } else await reporter.failed(failure);
    });
  };
}
