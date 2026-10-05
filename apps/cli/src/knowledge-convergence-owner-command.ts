import { openProjectStorage } from "@lervo/project-storage";
import {
  readConvergenceOwnerFence,
  readConvergenceOwnerHost,
} from "@lervo/repository-knowledge-runtime";

import { createKnowledgeConvergenceOwnership } from "./knowledge-convergence-ownership.js";
import type { CliIo } from "./types.js";

const usage = "Usage: lervo knowledge convergence owner <status|release> [--json]\n";

/**
 * `status` reports this host's identity and latest ownership verdict without contacting the Hub.
 * `release` hands a held Hub lease to a peer: this host yields for one lease lifetime.
 */
export async function runKnowledgeConvergenceOwnerCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const action = args[0];
  if (
    (action !== "status" && action !== "release") ||
    args.slice(1).some((arg) => arg !== "--json")
  ) {
    io.stderr(usage);
    return 1;
  }
  const indent = args.includes("--json") ? 2 : undefined;
  try {
    if (action === "status") {
      const host = await readConvergenceOwnerHost(io.cwd);
      const fence = await readConvergenceOwnerFence(io.cwd);
      io.stdout(
        `${JSON.stringify(
          {
            host:
              host === null
                ? null
                : {
                    hostHash: host.hostHash,
                    hostLabel: host.config.hostLabel,
                    mode: host.config.coordination.mode,
                  },
            verdict: fence?.verdict ?? null,
          },
          null,
          indent,
        )}\n`,
      );
      return 0;
    }
    const storage = await openProjectStorage(io.cwd);
    try {
      const { verdict, hubReleased } = await createKnowledgeConvergenceOwnership(storage).release();
      io.stdout(`${JSON.stringify({ status: "yielding", hubReleased, verdict }, null, indent)}\n`);
      return 0;
    } finally {
      await storage.close();
    }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    io.stderr(
      `${typeof code === "string" && /^[a-z][a-z0-9_]{0,127}$/u.test(code) ? code : "convergence_owner_command_failed"}\n`,
    );
    return 1;
  }
}
