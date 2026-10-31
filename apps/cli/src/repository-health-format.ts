import type { RepositoryHealthProjectionV1 } from "@lervo/application-contract";

export const MAXIMUM_HEALTH_SECTION_BYTES = 520;

function singleLine(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]/gu, " ");
}

/** Whole lines survive the cap; no recommendation or inspect command is cut in half. */
function capped(lines: string[], age: string): string {
  const kept: string[] = [];
  for (const line of lines) {
    const remaining = lines.length - kept.length - 1;
    const tail =
      remaining > 0
        ? `\nLervo health: omitted ${remaining}; lervo application attention --json.`
        : "";
    if (Buffer.byteLength([...kept, line].join("\n") + tail) > MAXIMUM_HEALTH_SECTION_BYTES) break;
    kept.push(line);
  }
  const omitted = lines.length - kept.length;
  if (omitted > 0)
    kept.push(
      `Lervo health: omitted ${omitted}; lervo application attention --json.${kept.length === 0 ? ` [projection age ${age}]` : ""}`,
    );
  return kept.join("\n");
}

function duration(milliseconds: number | null): string {
  if (milliseconds === null) return "unknown";
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 120) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * Rendering is pure. A healthy repository costs no bytes. Each gap is one line naming the actor
 * that handles it; only consequential effects are owner-actionable. Unknown measures collapse into
 * one line, and raw counters stay in the attention JSON.
 */
export function formatRepositoryHealth(
  projection: RepositoryHealthProjectionV1,
  now: Date,
): string {
  const m = projection.measures;
  const ageMinutes = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(projection.observedAt)) / 60_000),
  );
  const absentProjection = Object.values(m).every(
    (measure) =>
      measure.reason === "projection_missing_or_unreadable" ||
      measure.reason === "projection_invalid",
  );
  const age = absentProjection ? "unknown" : `${ageMinutes}m`;
  const lines: string[] = [];
  const owner = m.ownerReview.value;
  const ownerCount = owner?.count ?? owner?.confirmedCount ?? 0;
  if (m.ownerReview.status === "gap" && owner !== null && ownerCount > 0) {
    const items = owner.items.filter(
      (item) => item.requiresUserAction && item.consequence !== null,
    );
    const recommendations = items.map(
      (item) =>
        `${item.itemId}: ${singleLine(item.recommendation)}; inspect: ${item.inspectCommand}`,
    );
    // Reserve space for every retained recommendation and an exact inspect command.
    const selected: string[] = [];
    for (const recommendation of recommendations) {
      if (Buffer.byteLength(selected.concat(recommendation).join(" | ")) > 300) break;
      selected.push(recommendation);
    }
    const omitted = ownerCount - selected.length;
    lines.push(
      `Lervo health: needs owner authority (${owner.count === null ? "at least " : ""}${ownerCount}): ${selected.join(" | ")}${omitted > 0 ? `${selected.length ? "; " : ""}omitted ${omitted}; inspect: lervo application attention --json` : ""}.`,
    );
  }
  const convergenceGap = m.convergence.status === "gap" && m.convergence.value !== null;
  if (convergenceGap) {
    const v = m.convergence.value!;
    const since = v.since === null ? null : now.getTime() - Date.parse(v.since);
    lines.push(
      `Lervo health: knowledge stopped ${duration(since)} (${v.reason ?? v.state}); ${v.owner}; recovery: ${v.recovery}.`,
    );
  }
  // The longest stop repeats the convergence line when one stop is current.
  if (!convergenceGap && m.longestStop.status === "gap" && m.longestStop.value !== null) {
    const v = m.longestStop.value;
    lines.push(
      `Lervo health: a knowledge stop lasted ${duration(v.ageMilliseconds)}${v.reportedAt === null ? ", reporting unknown" : ""}; resident.`,
    );
  }
  if (m.freshness.status === "gap" && m.freshness.value !== null) {
    const v = m.freshness.value;
    lines.push(
      `Lervo health: ${v.stale === null ? "freshness evaluation unknown" : `${v.stale}/${v.evaluated} evaluated documents stale, ${v.unevaluated} unevaluated`}; freshness cycle.`,
    );
  }
  if (m.deferred.status === "gap" && m.deferred.value !== null) {
    const ages = m.deferred.value.items.map((item) => item.ageMilliseconds);
    const oldest = ages.some((value) => value === null) ? null : Math.max(0, ...(ages as number[]));
    lines.push(
      `Lervo health: ${m.deferred.value.count} documents await route classification (oldest ${duration(oldest)}); resident classifier.`,
    );
  }
  if (m.brokenLinks.status === "gap" && m.brokenLinks.value !== null) {
    lines.push(`Lervo health: ${m.brokenLinks.value.count} broken links; freshness cycle.`);
  }
  if (m.find.status === "gap" && m.find.value !== null) {
    const v = m.find.value;
    const injected =
      v.lastInjectedAt === null
        ? "last recorded injection unknown"
        : `last injection ${duration(now.getTime() - Date.parse(v.lastInjectedAt))} ago`;
    lines.push(
      `Lervo health: Find unproven (${injected}; ${v.referencedCount} references in 7d); context preparer.`,
    );
  }
  const unknown = Object.entries(m)
    .filter(([, measure]) => measure.status === "unknown" || measure.coverage === "partial")
    .map(([name]) => name);
  if (unknown.length > 0)
    lines.push(
      `Lervo health: unknown: ${unknown.join(", ")} (lervo application attention --json).`,
    );
  if (lines[0] !== undefined) lines[0] += ` [age ${age}]`;
  return capped(lines.map(singleLine), age);
}
