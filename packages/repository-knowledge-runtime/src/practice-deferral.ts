/** Admission and daily limits are resumable waits, never evidence of a failed provider call. */
export function practiceResumeAt(error: unknown, now: Date): string | null {
  const reason = error instanceof Error ? error.message : "";
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  if (reason === "practice_budget_exhausted" || code === "normalization_budget_exceeded")
    return new Date(
      Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) + 86_400_000,
    ).toISOString();
  if (
    ["provider_not_admitted", "foreground_pending", "practice_reader_activation_pending"].includes(
      reason,
    ) ||
    [
      "provider_not_admitted",
      "knowledge_provider_paused",
      "knowledge_capacity_unavailable",
      "knowledge_authority_unavailable",
    ].includes(code)
  )
    return new Date(now.getTime() + 60_000).toISOString();
  return null;
}

export function practiceReady(item: { resumeAt?: string | null }, now: Date): boolean {
  return item.resumeAt == null || Date.parse(item.resumeAt) <= now.getTime();
}
