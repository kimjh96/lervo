import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  listCanonicalizationCandidates,
  reopenCanonicalizationCandidate,
} from "@lervo/repository-knowledge";

import { REMOVED_CANONICALIZATION_REVIEW } from "./removed-approval-options.js";
import type { CliIo } from "./types.js";

/**
 * `lervo knowledge canonicalization status|reopen`. ADR-0561 removed `review` and `promote`: the
 * background canonical reviewer resolves every candidate, and `reopen` undoes its decision.
 */
export async function runKnowledgeCanonicalization(args: string[], io: CliIo): Promise<number> {
  try {
    const action = args[0];
    if (action === "review" || action === "promote")
      throw new Error(REMOVED_CANONICALIZATION_REVIEW);
    if (action !== "status" && action !== "reopen")
      throw new Error("Canonicalization requires status or reopen.");
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: { root: { type: "string" }, json: { type: "boolean" } },
    });
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    if (action === "reopen") {
      if (parsed.positionals.length !== 1)
        throw new Error("Canonicalization reopen requires one candidate ID.");
      const result = await reopenCanonicalizationCandidate({
        repositoryRoot: root,
        candidateId: parsed.positionals[0]!,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Canonicalization candidate reopened: ${result.candidateId}\nThe background canonical reviewer judges it again.\n`,
      );
      return 0;
    }
    if (parsed.positionals.length > 1)
      throw new Error("Canonicalization status accepts at most one candidate ID.");
    const candidates = (await listCanonicalizationCandidates(root)).filter(
      (item) => parsed.positionals[0] === undefined || item.candidateId === parsed.positionals[0],
    );
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ schemaVersion: 1, candidates }, null, 2)}\n`
        : `Canonicalization candidates: ${candidates.length}\n${candidates
            .map(
              (item) =>
                `  ${item.observedState} ${item.candidateId} · sources ${item.sourceBindings.length} · targets ${item.recommendedRoots.join(",")}`,
            )
            .join("\n")}${candidates.length === 0 ? "" : "\n"}`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
