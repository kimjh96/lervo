/**
 * ADR-0653: what a plan reviewer is shown of a moved document. A move keeps every byte, so the
 * reviewer judges only where the document goes, and its bytes are bound by hash. A move that
 * rewrites references shows the lines it rewrites; Lervo checked that every other line is
 * byte-identical. One large moved document therefore never pushes a whole plan's review past its
 * bound, which stopped an `axli-lab` layout plan with `knowledge_source_limit_exceeded`.
 */
interface ReviewSource {
  path: string;
  contentHash: string | null;
  content: string | null;
  ownership?: "lervo_generated";
}

/** A moved document as the reviewer sees it, in place of its bytes. */
export interface DisclosedMoveSource extends ReviewSource {
  content: null;
  movedTo: string;
  /**
   * Absent for a byte-identical move; otherwise every line the move rewrites, 1-based, as the
   * changed span from `column` (1-based) with up to 80 unchanged characters around it.
   */
  rewrittenLines?: Array<{ line: number; column: number; before: string; after: string }>;
}

interface MoveOperation {
  path: string;
  destinationPath: string;
  action: "move" | "move_update";
  content?: string;
}

/** Unchanged characters shown around a rewritten span, so a long line stays bounded. */
const CONTEXT_CHARACTERS = 80;

function moves(plan: unknown): MoveOperation[] {
  const value = (plan as { operations?: unknown } | null)?.operations;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is MoveOperation =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as MoveOperation).path === "string" &&
      typeof (item as MoveOperation).destinationPath === "string" &&
      ((item as MoveOperation).action === "move" ||
        ((item as MoveOperation).action === "move_update" &&
          typeof (item as MoveOperation).content === "string")),
  );
}

/** The changed span of one line, with bounded unchanged context on each side. */
function changedSpan(
  line: number,
  before: string,
  after: string,
): { line: number; column: number; before: string; after: string } {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix += 1;
  const from = Math.max(0, prefix - CONTEXT_CHARACTERS);
  return {
    line,
    column: from + 1,
    before: before.slice(
      from,
      Math.min(before.length, before.length - suffix + CONTEXT_CHARACTERS),
    ),
    after: after.slice(from, Math.min(after.length, after.length - suffix + CONTEXT_CHARACTERS)),
  };
}

/** Every line that differs, as its changed span, when only lines change in place; null otherwise. */
function rewrittenLines(
  before: string,
  after: string,
): Array<{ line: number; column: number; before: string; after: string }> | null {
  const old = before.split("\n");
  const next = after.split("\n");
  if (old.length !== next.length) return null;
  return old.flatMap((line, index) =>
    line === next[index] ? [] : [changedSpan(index + 1, line, next[index]!)],
  );
}

/**
 * The review's plan and sources with moved documents disclosed by hash and rewritten lines. A
 * rewrite that is not a set of in-place line changes keeps its full bytes, as before.
 */
export function discloseLifecyclePlanMoves<Source extends ReviewSource>(
  plan: unknown,
  sources: readonly Source[],
): { plan: unknown; sources: Array<Source | DisclosedMoveSource> } {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const disclosed = new Map<string, DisclosedMoveSource>();
  const summarized = new Set<MoveOperation>();
  for (const move of moves(plan)) {
    const source = byPath.get(move.path);
    if (source === undefined || source.content === null) continue;
    if (move.action === "move") {
      disclosed.set(move.path, { ...source, content: null, movedTo: move.destinationPath });
      continue;
    }
    const lines = rewrittenLines(source.content, move.content!);
    if (lines === null) continue;
    disclosed.set(move.path, {
      ...source,
      content: null,
      movedTo: move.destinationPath,
      rewrittenLines: lines,
    });
    summarized.add(move);
  }
  const operations = (plan as { operations?: unknown } | null)?.operations;
  return {
    plan:
      summarized.size === 0 || !Array.isArray(operations)
        ? plan
        : {
            ...(plan as Record<string, unknown>),
            operations: operations.map((operation) => {
              if (!summarized.has(operation as MoveOperation)) return operation;
              const { content: _content, ...rest } = operation as MoveOperation;
              return { ...rest, contentDisclosed: false, rewrittenLinesOf: rest.path };
            }),
          },
    sources: sources.map((source) => disclosed.get(source.path) ?? source),
  };
}
