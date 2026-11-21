import { repositoryWatchReporter } from "@lervo/repository-knowledge-runtime";

/**
 * ADR-0602: records a change loop that runs without a change signal as
 * `conversation_change_signal_unavailable` attention on the repository, cleared when the loop
 * stops. Each loop gets its own record, so one loop's recovery never clears another's.
 */
export function changeSignalAttention(repositoryRoot: string): (failure: unknown) => void {
  const reporter = repositoryWatchReporter(
    repositoryRoot,
    "conversation_change_signal_unavailable",
  );
  let write: Promise<void> = Promise.resolve();
  return (failure) => {
    write = write.then(() => (failure === null ? reporter.armed() : reporter.failed(failure)));
  };
}
