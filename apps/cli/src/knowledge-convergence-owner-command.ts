import { loadProjectManifest } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import {
  acknowledgeKnowledgePublicationAttention,
  readConvergenceOwnerFence,
  readConvergenceOwnerHost,
  readKnowledgePublicationState,
  requestKnowledgeResidentCycle,
} from "@lervo/repository-knowledge-runtime";

import { convergenceOwnerRemediation } from "./knowledge-convergence-owner-remediation.js";
import {
  createKnowledgeConvergenceOwnership,
  createKnowledgePublisher,
} from "./knowledge-convergence-ownership.js";
import type { CliIo } from "./types.js";

const usage =
  "Usage: lervo knowledge convergence owner <status|release|publish|acknowledge> [--json]\n";
const ACTIONS = new Set(["status", "release", "publish", "acknowledge"]);

/**
 * `status` reports this host's identity, latest ownership verdict, and publication state without
 * contacting the Hub or GitHub. `release` hands a held Hub lease to a peer: this host yields for
 * one lease lifetime. `publish` runs one knowledge publication now, as the owner's resident does
 * after each cycle, and asks the resident to take over any retry it left. `acknowledge` keeps the
 * owner decisions the publisher reports, a base change of the last merged publication and pull
 * requests closed without merge, without their attention (ADR-0603); Lervo still never publishes
 * those commits.
 */
export async function runKnowledgeConvergenceOwnerCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const action = args[0];
  if (
    action === undefined ||
    !ACTIONS.has(action) ||
    args.slice(1).some((arg) => arg !== "--json")
  ) {
    io.stderr(usage);
    return 1;
  }
  const indent = args.includes("--json") ? 2 : undefined;
  const print = (value: unknown) => io.stdout(`${JSON.stringify(value, null, indent)}\n`);
  try {
    if (action === "status") {
      const host = await readConvergenceOwnerHost(io.cwd);
      const verdict = (await readConvergenceOwnerFence(io.cwd))?.verdict ?? null;
      const projectId = await loadProjectManifest(io.cwd).then(
        (manifest) => manifest.projectId,
        () => null,
      );
      print({
        host:
          host === null
            ? null
            : {
                hostHash: host.hostHash,
                hostLabel: host.config.hostLabel,
                mode: host.config.coordination.mode,
                publication: host.config.publication ?? null,
              },
        verdict,
        remediation:
          verdict === null
            ? null
            : convergenceOwnerRemediation(
                verdict,
                host?.config.coordination.mode === "hub" && projectId !== null
                  ? { projectId, destinationId: host.config.coordination.hub.destinationId }
                  : null,
              ),
        publication: await readKnowledgePublicationState(io.cwd),
      });
      return 0;
    }
    if (action === "acknowledge") {
      print(
        await acknowledgeKnowledgePublicationAttention(
          io.cwd,
          await readKnowledgePublicationState(io.cwd),
        ),
      );
      return 0;
    }
    const storage = await openProjectStorage(io.cwd);
    try {
      if (action === "publish") {
        const result = await createKnowledgePublisher(io.cwd)({ events: storage });
        // ADR-0606: a retry this publication asks for (checks still running, a review or merge
        // gate, a transient failure) is armed only from the resident's own publish result, so a
        // publication run here asks the resident to publish once and take the retry over.
        if (result.status === "published" && result.retryAfterMs !== null)
          await requestKnowledgeResidentCycle(io.cwd);
        print(result);
        return 0;
      }
      const { verdict, hubReleased } = await createKnowledgeConvergenceOwnership(storage).release();
      print({ status: "yielding", hubReleased, verdict });
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
