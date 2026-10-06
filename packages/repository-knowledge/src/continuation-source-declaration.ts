import { parse } from "yaml";

/** The dedicated legacy alias the default `continuation_source` document role declares. */
export const LEGACY_CONTINUATION_ALIAS = "HANDOFF.md";

export type ContinuationSourceDeclaration = "declared_legacy_alias" | "explicit_metadata";

function declaredByMetadata(content: string): boolean {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return false;
  const boundary = /\r?\n---\r?\n/gu;
  boundary.lastIndex = content.indexOf("\n") + 1;
  const match = boundary.exec(content);
  if (match === null || match.index > 8192) return false;
  try {
    const value = parse(content.slice(content.indexOf("\n") + 1, match.index)) as {
      lervo?: { workstream?: { continuation?: unknown } };
    } | null;
    return value?.lervo?.workstream?.continuation === true;
  } catch {
    return false;
  }
}

/**
 * ADR-0476: whether the repository declares this Markdown as continuation state. Only the legacy
 * alias path or `lervo.workstream.continuation: true` front matter counts; a file name, heading,
 * or phrase that merely resembles a handoff never does.
 */
export function declaredContinuationSource(
  path: string,
  content: string,
): ContinuationSourceDeclaration | null {
  if (path === LEGACY_CONTINUATION_ALIAS) return "declared_legacy_alias";
  return declaredByMetadata(content) ? "explicit_metadata" : null;
}
