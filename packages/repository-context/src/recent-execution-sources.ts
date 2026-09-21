import type { RepositorySupplementalSource } from "@lervo/repository-knowledge";

export function selectRecentExecutionSources(
  sources: readonly RepositorySupplementalSource[],
  limit: number,
): RepositorySupplementalSource[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("The execution event window limit is invalid.");
  }
  const ordered = sources.map((source) => {
    const event = JSON.parse(source.content) as { seq?: unknown };
    if (source.kind !== "execution_event" || !Number.isSafeInteger(event.seq)) {
      throw new TypeError("A validated execution event source has no sequence.");
    }
    return { source, seq: event.seq as number };
  });
  ordered.sort((left, right) => left.seq - right.seq);
  if (ordered.some((entry, index) => index > 0 && entry.seq === ordered[index - 1]!.seq)) {
    throw new TypeError("Execution event sources have duplicate sequences.");
  }
  return ordered.slice(-limit).map((entry) => entry.source);
}
