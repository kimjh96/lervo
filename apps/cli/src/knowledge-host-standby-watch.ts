import { waitForProcessExit } from "@lervo/project-storage";
import { issueAttention } from "@lervo/repository-knowledge-runtime";

import {
  hostResidentCandidates,
  type ResidentProvider,
} from "./knowledge-host-resident-candidates.js";

/**
 * ADR-0602: a standby host waits for its lock holder's exit or release, then rescans. A holder it
 * cannot see (another namespace or state directory, or a stuck process) is attention on every
 * repository this host would serve, until it is seen again or the wait ends; the lock file, which
 * a new holder rewrites, stays watched by the caller. Returns a cancel.
 */
export function watchStandbyHolder(input: {
  holderPresence: string;
  provider: ResidentProvider | null;
  onExit: () => void;
  onFailure: (error: unknown) => void;
}): () => void {
  const attention = new Map<string, ReturnType<typeof issueAttention>>();
  let cancelled = false;
  let reporting: Promise<void> = Promise.resolve();
  const report = (issue: string | null) => {
    reporting = reporting
      .then(async () => {
        if (issue !== null && attention.size === 0 && !cancelled)
          for (const root of (await hostResidentCandidates(input.provider)).wanted.keys())
            attention.set(root, issueAttention(root, "process_exit_wait_unavailable"));
        for (const entry of attention.values()) entry.report(cancelled ? null : issue);
      })
      .catch(input.onFailure);
  };
  const cancel = waitForProcessExit(input.holderPresence, input.onExit, { onIssue: report });
  return () => {
    cancelled = true;
    cancel();
    report(null);
  };
}
