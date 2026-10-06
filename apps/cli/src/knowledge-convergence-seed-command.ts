import { openProjectStorage } from "@lervo/project-storage";

import { createKnowledgeConvergenceContinuity } from "./knowledge-convergence-ownership.js";
import type { CliIo } from "./types.js";

const usage = "Usage: lervo knowledge convergence delegation seed [--json]";

/**
 * ADR-0469: runs one continuity reconciliation now, as the resident does each hour. Under the
 * host policy it seeds a missing delegation from a peer host's scope (exchanged through the Hub)
 * or the policy template, or renews a due one at the same scope. Without a policy it changes
 * nothing and reports why.
 */
export async function runKnowledgeConvergenceSeedCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  if (args.some((arg) => arg !== "--json")) {
    io.stderr(`${usage}\n`);
    return 1;
  }
  try {
    const storage = await openProjectStorage(io.cwd);
    try {
      const before = storage.events.latest()?.eventId ?? null;
      const state = await createKnowledgeConvergenceContinuity(storage).reconcile({ force: true });
      if (state === null) throw new Error("Another knowledge worker holds this repository.");
      const changed =
        state.lastContinuation !== null &&
        state.lastContinuation.at === state.observedAt &&
        (storage.events.latest()?.eventId ?? null) !== before;
      io.stdout(
        `${JSON.stringify(
          {
            status: changed ? state.lastContinuation!.action : "unchanged",
            delegation: state.delegation,
            policy: state.policy,
            ownerHost: state.ownerHost,
            lastContinuation: state.lastContinuation,
            continuationFailure: state.continuationFailure,
            findings: state.findings,
          },
          null,
          args.includes("--json") ? 2 : undefined,
        )}\n`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${usage}\n`);
    return 1;
  }
}
