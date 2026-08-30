import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  listCanonicalizationCandidates,
  transitionCanonicalizationCandidate,
} from "@lervo/repository-knowledge";

import type { CliIo } from "./types.js";

export async function runKnowledgeCanonicalization(args: string[], io: CliIo): Promise<number> {
  try {
    const action = args[0];
    if (!["status", "review", "promote"].includes(action ?? ""))
      throw new Error("Canonicalization requires status, review, or promote.");
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        decision: { type: "string" },
        reviewer: { type: "string" },
        approval: { type: "string" },
        target: { type: "string" },
        "target-hash": { type: "string" },
      },
    });
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    if (action === "status") {
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
    }
    if (parsed.positionals.length !== 1)
      throw new Error(`Canonicalization ${action} requires one candidate ID.`);
    if (typeof parsed.values.reviewer !== "string" || typeof parsed.values.approval !== "string")
      throw new Error(`Canonicalization ${action} requires --reviewer and --approval.`);
    const result = await transitionCanonicalizationCandidate({
      repositoryRoot: root,
      candidateId: parsed.positionals[0]!,
      expectedContentHash: parsed.values.approval,
      action:
        action === "promote"
          ? "promote"
          : parsed.values.decision === "defer"
            ? "defer"
            : parsed.values.decision === "reject"
              ? "reject"
              : (() => {
                  throw new Error("Canonicalization review requires --decision defer or reject.");
                })(),
      reviewerId: parsed.values.reviewer,
      ...(action === "promote"
        ? {
            targetPath: parsed.values.target,
            targetContentHash: parsed.values["target-hash"],
          }
        : {}),
      now: new Date(),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Canonicalization candidate ${result.observedState}: ${result.candidateId}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
