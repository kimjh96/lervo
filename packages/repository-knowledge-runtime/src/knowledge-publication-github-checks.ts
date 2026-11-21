import {
  MAXIMUM_NAMED_CHECK_FAILURES,
  type KnowledgePublicationCheckFailure,
  type KnowledgePublicationChecks,
} from "./knowledge-publication-forge.js";

/** Reduces a GitHub status check rollup to the publication's check outcome (ADR-0596, ADR-0603). */

const CHECK_NAME_LIMIT = 100;
const RUN_LINK = /\/actions\/runs\/(\d{1,19})(?:\/|$)/u;
const JOB_LINK = /\/actions\/runs\/\d{1,19}\/job\/(\d{1,19})$/u;

/** A bounded, printable check name; control characters and overlong names never reach state. */
function checkName(item: Record<string, unknown>): string {
  const raw = item.__typename === "StatusContext" ? item.context : item.name;
  const name = (typeof raw === "string" ? raw : "").replace(/[\p{Cc}\p{Cf}]/gu, " ").trim();
  if (name === "") return item.__typename === "StatusContext" ? "unnamed status" : "unnamed check";
  return name.length > CHECK_NAME_LIMIT ? `${name.slice(0, CHECK_NAME_LIMIT - 1)}…` : name;
}

function linkedId(item: Record<string, unknown>, pattern: RegExp): number | null {
  const link = typeof item.detailsUrl === "string" ? item.detailsUrl : "";
  const id = Number(pattern.exec(link)?.[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The newest run of each Actions check. A rerun or a reopened pull request adds runs to the same
 * head and leaves the earlier ones in the rollup; like GitHub's merge gate, only the latest run of
 * a workflow job counts. Commit statuses already arrive as the latest state per context.
 */
function latestCheckRuns(items: Record<string, unknown>[]): Record<string, unknown>[] {
  const latest = new Map<string, { index: number; startedAt: string }>();
  // A run without a name or a start time cannot be matched to a later one, so it always counts.
  const comparable = (item: Record<string, unknown>) =>
    item.__typename !== "StatusContext" &&
    typeof item.name === "string" &&
    item.name !== "" &&
    typeof item.startedAt === "string";
  items.forEach((item, index) => {
    if (!comparable(item)) return;
    const key = `${String(item.workflowName ?? "")}\u0000${String(item.name)}`;
    const startedAt = String(item.startedAt);
    const seen = latest.get(key);
    if (seen === undefined || startedAt >= seen.startedAt) latest.set(key, { index, startedAt });
  });
  const kept = new Set([...latest.values()].map((entry) => entry.index));
  return items.filter((item, index) => !comparable(item) || kept.has(index));
}

/**
 * Reduces a status rollup for one exact head; a moved head is still pending. Only success
 * passes. A skipped check did not run for this pull request, so it neither passes nor blocks;
 * every other finished conclusion, including neutral and cancelled, fails. A commit status
 * whose exact name is in `ignore` is left out entirely (ADR-0596); check runs are never ignored. Failed items are named, at
 * most eight, with the Actions run that owns each check run.
 */
export function summarizeKnowledgePublicationChecks(input: {
  headSha: string;
  observedHeadSha: string;
  rollup: unknown;
  ignore?: readonly string[];
  /** ADR-0603: check names the repository requires; one that has not reported is pending. */
  required?: readonly string[];
}): KnowledgePublicationChecks {
  const ignored = new Set(input.ignore ?? []);
  // Only outside commit statuses can be ignored; an Actions job with the same name still counts.
  const items = latestCheckRuns(
    (Array.isArray(input.rollup) ? (input.rollup as unknown[]) : [])
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
      .filter((item) => !(item.__typename === "StatusContext" && ignored.has(checkName(item)))),
  );
  if (input.observedHeadSha !== input.headSha)
    return { state: "pending", total: items.length, reason: "head_moved" };
  if (items.length === 0) return { state: "pending", total: 0, reason: "none" };
  // ADR-0603: a required check that has not reported keeps the head pending while others run,
  // and fails, named, once every reported check finished, so it never waits silently.
  const reported = new Set(items.map(checkName));
  const missing = (input.required ?? []).filter((name) => !reported.has(name));
  let failed = 0;
  let succeeded = 0;
  const failures: KnowledgePublicationCheckFailure[] = [];
  for (const item of items) {
    const status = item.__typename === "StatusContext";
    const conclusion = status
      ? String(item.state ?? "")
      : String(item.status ?? "") === "COMPLETED"
        ? String(item.conclusion ?? "")
        : "";
    if (conclusion === "" || conclusion === "PENDING" || conclusion === "EXPECTED")
      return { state: "pending", total: items.length, reason: "running" };
    if (conclusion === "SUCCESS") succeeded++;
    else if (conclusion !== "SKIPPED") {
      failed++;
      if (failures.length < MAXIMUM_NAMED_CHECK_FAILURES)
        failures.push({
          name: checkName(item),
          kind: status ? "status" : "check_run",
          conclusion: conclusion.toLowerCase(),
          runId: status ? null : linkedId(item, RUN_LINK),
          jobId: status ? null : linkedId(item, JOB_LINK),
        });
    }
  }
  for (const name of missing) {
    failed++;
    if (failures.length < MAXIMUM_NAMED_CHECK_FAILURES)
      failures.push({ name, kind: "status", conclusion: "not_reported", runId: null, jobId: null });
  }
  if (failed > 0) return { state: "failed", total: items.length, failed, failures };
  return succeeded === 0
    ? { state: "pending", total: items.length, reason: "skipped_only" }
    : { state: "passed", total: items.length };
}
