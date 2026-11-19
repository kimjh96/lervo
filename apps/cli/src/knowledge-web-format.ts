import type {
  RelationSuspectSet,
  RelationWebRefresh,
  RelationWebStats,
} from "@lervo/repository-knowledge";

const SAMPLE = 40;

/** The refresh outcome without the web itself, for output. */
export function relationWebRefreshSummary(refresh: RelationWebRefresh) {
  return refresh.status === "current"
    ? {
        status: refresh.status,
        extracted: refresh.extracted,
        reused: refresh.reused,
        durationMs: refresh.durationMs,
      }
    : { status: refresh.status, code: refresh.code, message: refresh.message };
}

function refreshLine(refresh: RelationWebRefresh): string {
  return refresh.status === "current"
    ? `Relation web: current · ${refresh.durationMs} ms · extracted ${refresh.extracted} · reused ${refresh.reused}`
    : `Relation web: stale (${refresh.code}): ${refresh.message}`;
}

export function formatRelationWebStats(
  refresh: RelationWebRefresh,
  stats: RelationWebStats,
): string {
  const kinds = Object.entries(stats.edgesByKind).map(
    ([kind, strengths]) =>
      `  ${kind}: ${Object.entries(strengths)
        .map(([strength, count]) => `${strength} ${count}`)
        .join(", ")}`,
  );
  return `${refreshLine(refresh)}\ndocuments ${stats.documents} (historical ${stats.historicalDocuments}) · edges ${stats.edges}\n${kinds.join("\n")}\n`;
}

export function formatRelationWebSuspects(
  refresh: RelationWebRefresh,
  since: string,
  result: RelationSuspectSet,
): string {
  const lines = result.suspects.slice(0, SAMPLE).map((suspect) => {
    const reasons = suspect.reasons
      .slice(0, 3)
      .map(
        (reason) =>
          `${reason.reason} ${reason.target}${reason.line > 0 ? ` (line ${reason.line})` : ""}`,
      )
      .join("; ");
    return `  ${suspect.document}: ${reasons}${suspect.reasons.length > 3 ? "; …" : ""}`;
  });
  if (result.suspects.length > SAMPLE) lines.push(`  … ${result.suspects.length - SAMPLE} more`);
  return `${refreshLine(refresh)}\nSuspects since ${since}: ${result.suspects.length} documents, ${result.superseded.length} superseded\n${lines.join("\n")}\n`;
}
