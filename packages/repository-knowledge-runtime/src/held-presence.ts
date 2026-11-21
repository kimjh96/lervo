import { holdProcessPresence, type HeldProcessPresence } from "@lervo/project-storage";

import { repositoryWatchReporter } from "./repository-watch-state.js";

/**
 * Mixed versions only: how often a row is rewritten while a writer of an earlier release, which
 * removes rows whose heartbeat is older than two minutes, shares the table.
 */
export const EARLIER_WRITER_REFRESH_MILLISECONDS = 60_000;

/**
 * ADR-0602: this process's presence for a repository's records. Its token is recorded only once
 * the socket listens; a presence that could not be held records no token, so readers keep the
 * rule they used before, and is attention (`process_presence_unavailable`) until the process
 * stops.
 */
export function heldRepositoryPresence(repositoryRoot: string): {
  presence: HeldProcessPresence;
  /** The token to record, or null when the presence could not be held. */
  token(): Promise<string | null>;
  release(): Promise<void>;
} {
  const presence = holdProcessPresence();
  const reporter = repositoryWatchReporter(repositoryRoot, "process_presence_unavailable");
  const settled = presence.ready.then(async () => {
    const issue = presence.issue();
    if (issue === null) return presence.token;
    await reporter.failed(Object.assign(new Error(issue), { code: "presence_unavailable" }));
    return null;
  });
  return {
    presence,
    token: () => settled,
    release: async () => {
      presence.release();
      await settled;
      await reporter.armed();
    },
  };
}
