import { relationNodeDocument, type RelationWeb } from "./relation-web.js";

/**
 * Every fully superseded document mapped to the current document that supersedes it, from the
 * web's header relations (ADR-0562, roadmap item 8): `Supersedes`, `Superseded by`, and
 * `Status: superseded by` declarations, with bare ADR numbers resolved to their documents. A
 * superseded part (`Supersedes in part`, `Superseded in part by`) is no full supersession, and
 * prose that merely says "supersedes" declares nothing. When several documents supersede one,
 * the first by path is kept.
 */
export function relationWebSuccessors(web: RelationWeb): Map<string, string> {
  const successors = new Map<string, string>();
  const documents = [...web.documents.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  for (const document of documents)
    for (const edge of document.edges) {
      if (edge.kind !== "supersedes") continue;
      const successor = relationNodeDocument(web, edge.from);
      const superseded = relationNodeDocument(web, edge.to);
      if (successor === null || superseded === null || successor === superseded) continue;
      if (!successors.has(superseded)) successors.set(superseded, successor);
    }
  return successors;
}
