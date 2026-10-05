import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import {
  documentFreshnessPolicy,
  loadRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import {
  acknowledgeFreshnessCandidate,
  applyFreshnessCandidateByOwner,
  assertFreshnessEventsWritable,
  inspectDocumentFreshnessStatus,
  listDocumentFreshnessReview,
  rejectFreshnessCandidate,
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

const actions = ["status", "review", "apply", "revert", "reject", "acknowledge"] as const;
type Action = (typeof actions)[number];

/** `lervo knowledge freshness status|review|apply|revert|reject|acknowledge` (ADR-0463). */
export async function runKnowledgeFreshness(args: string[], io: CliIo): Promise<number> {
  let json = false;
  try {
    const action = args[0] as Action | undefined;
    if (action === undefined || !actions.includes(action))
      throw new Error(`Document freshness requires ${actions.join(", ")}.`);
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        approval: { type: "string" },
        reviewer: { type: "string" },
        reason: { type: "string" },
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
        switch (action) {
          case "apply":
            if (typeof parsed.values.approval !== "string")
              throw new Error("Freshness apply requires --approval <after-hash>.");
            return applyFreshnessCandidateByOwner({
              storage,
              candidate,
              approvalHash: parsed.values.approval,
              reviewer: parsed.values.reviewer ?? null,
              now,
            });
          case "revert":
            return revertFreshnessCandidate({
              storage,
              candidate,
              revertedBy: "owner",
              holdDays: policy.holdDays,
              now,
            });
          case "reject": {
            const reason = parsed.values.reason;
            if (reason !== "not_stale" && reason !== "incorrect")
              throw new Error("Freshness reject requires --reason not_stale or incorrect.");
            return rejectFreshnessCandidate({
              storage,
              candidate,
              reason,
              holdDays: policy.holdDays,
              now,
            });
          }
          default:
            return acknowledgeFreshnessCandidate(repositoryRoot, candidate, now);
        }
      });
      write(
        { schemaVersion: 1, candidate: result },
        `Freshness candidate ${result.candidateId}: ${result.state}${
          action !== "apply" || result.commitHash === null
            ? ""
            : ` · commit ${result.commitHash.slice(0, 12)}`
        }\n`,
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
