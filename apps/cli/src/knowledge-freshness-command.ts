import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import {
  documentFreshnessPolicy,
  loadRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import {
  requestKnowledgeResidentCycle,
  acknowledgeFreshnessCandidate,
  assertFreshnessEventsWritable,
  inspectDocumentFreshnessStatus,
  listDocumentFreshnessReview,
  renderDocumentFreshnessDiff,
  requireFreshnessCandidate,
  revertFreshnessCandidate,
  withDocumentFreshnessOwnerLock,
} from "@lervo/repository-knowledge-runtime";

import { writeCommandError } from "./command-error-output.js";
import {
  formatDocumentFreshnessCandidate,
  formatDocumentFreshnessReview,
  formatDocumentFreshnessStatus,
} from "./knowledge-freshness-format.js";
import type { CliIo } from "./types.js";

const actions = ["status", "review", "revert", "acknowledge"] as const;
type Action = (typeof actions)[number];

/**
 * `lervo knowledge freshness status|review|revert|acknowledge` (ADR-0463). Lervo applies every
 * cross-checked change itself (ADR-0561), so the owner inspects and undoes; nothing asks to approve.
 */
export async function runKnowledgeFreshness(args: string[], io: CliIo): Promise<number> {
  let json = false;
  try {
    const action = args[0] as Action | undefined;
    json = args.includes("--json");
    if (args[0] === "apply" || args[0] === "reject")
      throw new Error(
        `Freshness ${args[0]} was removed: Lervo applies cross-checked changes itself and reports each one; undo one with lervo knowledge freshness revert <candidate-id>.`,
      );
    if (action === undefined || !actions.includes(action))
      throw new Error(`Document freshness requires ${actions.join(", ")}.`);
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
      },
    });
    json = parsed.values.json === true;
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    const now = new Date();
    const write = (value: unknown, text: string) =>
      io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : text);
    if (action === "status") {
      if (parsed.positionals.length > 0) throw new Error("Freshness status takes no candidate ID.");
      const status = await inspectDocumentFreshnessStatus(root, now);
      write(status, formatDocumentFreshnessStatus(status));
      return 0;
    }
    if (action === "review" && parsed.positionals.length === 0) {
      const candidates = await listDocumentFreshnessReview(root);
      write({ schemaVersion: 1, candidates }, formatDocumentFreshnessReview(candidates));
      return 0;
    }
    if (parsed.positionals.length !== 1)
      throw new Error(`Freshness ${action} requires exactly one candidate ID.`);
    const candidateId = parsed.positionals[0]!;
    const storage = await openProjectStorage(root);
    try {
      const repositoryRoot = storage.paths.repositoryRoot;
      if (action === "review") {
        const candidate = await requireFreshnessCandidate(repositoryRoot, candidateId);
        const diff = await renderDocumentFreshnessDiff(storage, candidate);
        write(
          { schemaVersion: 1, candidate, diff },
          formatDocumentFreshnessCandidate(candidate, diff),
        );
        return 0;
      }
      assertFreshnessEventsWritable(storage);
      const policy = documentFreshnessPolicy(await loadRepositoryKnowledgePolicy(repositoryRoot));
      const result = await withDocumentFreshnessOwnerLock(repositoryRoot, async () => {
        const candidate = await requireFreshnessCandidate(repositoryRoot, candidateId);
        return action === "revert"
          ? revertFreshnessCandidate({
              storage,
              candidate,
              revertedBy: "owner",
              holdDays: policy.holdDays,
              now,
            })
          : acknowledgeFreshnessCandidate(repositoryRoot, candidate, now);
      });
      // ADR-0606: the decision changes freshness state no event records.
      await requestKnowledgeResidentCycle(repositoryRoot);
      write(
        { schemaVersion: 1, candidate: result },
        `Freshness candidate ${result.candidateId}: ${result.state}\n`,
      );
      return 0;
    } finally {
      await storage.close();
    }
  } catch (error) {
    if (json) writeCommandError(io, error, { json });
    else io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
