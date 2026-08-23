import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { loadProjectManifest } from "@lervo/project";
import { createSearchEvaluationCase, identifySearchQuery, type SearchAttempt } from "@lervo/search";
import { LocalSearchObservationStore, recordSearchEvaluationCase } from "@lervo/search-local";

import { managedSearchQuery } from "./managed-search-context.js";
import { searchArgumentError, searchErrorCode, searchUsage } from "./search-command-common.js";
import { formatSearchEvaluationCase } from "./search-evaluation-format.js";
import type { CliIo } from "./types.js";

function queryMatches(query: string, attempt: SearchAttempt): boolean {
  try {
    const identity = identifySearchQuery(query);
    return identity.queryDigest === attempt.queryDigest &&
      identity.queryCharacterCount === attempt.queryCharacterCount &&
      identity.queryTermCount === attempt.queryTermCount;
  } catch {
    return false;
  }
}

function reviewedQuery(value: string, attempt: SearchAttempt): string {
  if (queryMatches(value, attempt)) return value;
  try {
    const projected = managedSearchQuery(value, "");
    if (queryMatches(projected, attempt)) return projected;
  } catch {
    // The contract error below covers both invalid and non-matching input.
  }
  throw new Error("The reviewed sentence or managed-run task does not match the original search query coordinate.");
}

export async function runSearchCaseCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        query: { type: "string" },
        "maximum-rank": { type: "string" },
        match: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(searchArgumentError(error));
    return 1;
  }
  if (parsed.positionals.length !== 1 || parsed.values.query === undefined ||
    !["any", "all", undefined].includes(parsed.values.match)) {
    io.stderr(`A search attempt ID, reviewed query, and valid match are required.\n${searchUsage}\n`);
    return 1;
  }
  const requestedMaximumRank = parsed.values["maximum-rank"] === undefined
    ? undefined
    : Number(parsed.values["maximum-rank"]);
  if (requestedMaximumRank !== undefined && (!Number.isSafeInteger(requestedMaximumRank) ||
    requestedMaximumRank < 1 || requestedMaximumRank > 50)) {
    io.stderr(`maximum-rank must be an integer between 1 and 50.\n${searchUsage}\n`);
    return 1;
  }
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  try {
    const [manifest, store] = await Promise.all([
      loadProjectManifest(root),
      LocalSearchObservationStore.openExisting(root),
    ]);
    if (store === null) throw new Error("No search attempt and assessment are recorded.");
    const attempt = await store.readAttempt(parsed.positionals[0]!);
    const assessment = await store.readAssessment(attempt.attemptId);
    if (attempt.projectId !== manifest.projectId || assessment.projectId !== manifest.projectId) {
      throw new Error("The search attempt or assessment project coordinate does not match.");
    }
    const evaluationCase = createSearchEvaluationCase({
      attempt,
      assessment,
      query: reviewedQuery(parsed.values.query, attempt),
      maximumRank: requestedMaximumRank ?? Math.min(5, attempt.requestedLimit),
      matchMode: (parsed.values.match ?? "any") as "any" | "all",
    });
    await recordSearchEvaluationCase(root, evaluationCase);
    io.stdout(parsed.values.json
      ? `${JSON.stringify(evaluationCase, null, 2)}\n`
      : formatSearchEvaluationCase(evaluationCase));
    return 0;
  } catch (error) {
    io.stderr(`Could not create the search evaluation case. (${searchErrorCode(error)}) ${
      error instanceof Error ? error.message : "Unknown error."
    }\n`);
    return 1;
  }
}
