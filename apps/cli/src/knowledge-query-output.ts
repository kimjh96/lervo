// The text lines `lervo knowledge query` prints for its hits, and their reading back. The ADE
// shows what an agent's search found from these lines (ADE session-host protocol, "Tool detail"),
// so the format and its reader live together and a test holds them to each other.
import type { KnowledgeFreshness, KnowledgeQueryHit } from "@lervo/repository-knowledge";

const HEADLINE =
  /^Repository knowledge recommendations \((\d+); not evidence of loaded, injected, or used\)$/u;
const HIT = /^ {2}\s*\d+ {2}(.+) · (.+) · (current|stale|unknown)$/u;

/** The first line of the text output: how many documents the query recommended. */
export function knowledgeQueryHeadline(count: number): string {
  return `Repository knowledge recommendations (${count}; not evidence of loaded, injected, or used)`;
}

/** One hit's line: its score, title, path, and freshness. */
export function knowledgeQueryHitLine(
  hit: Pick<KnowledgeQueryHit, "score" | "title" | "path" | "freshness">,
): string {
  return `  ${hit.score.toString().padStart(2)}  ${hit.title} · ${hit.path} · ${hit.freshness}`;
}

export interface PrintedKnowledgeQueryHit {
  readonly title: string;
  readonly path: string;
  readonly freshness: KnowledgeFreshness;
}

/**
 * What a text output says the query found: the count from its headline, and its hits in rank
 * order, or undefined when the output does not start with the headline.
 */
export function readKnowledgeQueryOutput(
  output: string,
): { found: number; hits: PrintedKnowledgeQueryHit[] } | undefined {
  const lines = output.split("\n");
  const headline = HEADLINE.exec(lines[0]?.trimEnd() ?? "");
  if (headline === null) return undefined;
  const hits: PrintedKnowledgeQueryHit[] = [];
  for (const line of lines.slice(1)) {
    const hit = HIT.exec(line.trimEnd());
    if (hit !== null)
      hits.push({
        title: hit[1] as string,
        path: hit[2] as string,
        freshness: hit[3] as KnowledgeFreshness,
      });
  }
  return { found: Number(headline[1]), hits };
}
