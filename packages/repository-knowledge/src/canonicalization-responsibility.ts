export type CanonicalizationResponsibility =
  | "behavioral_instruction"
  | "architecture_or_specification"
  | "product_or_decision"
  | "executable_verification"
  | "mutable_continuation";

export function canonicalResponsibilityForPath(
  path: string,
): CanonicalizationResponsibility | null {
  if (path === "AGENTS.md" || path.startsWith("docs/instructions/"))
    return "behavioral_instruction";
  if (
    path.startsWith("docs/specs/") ||
    path.startsWith("docs/specifications/") ||
    path.startsWith("docs/architecture/")
  )
    return "architecture_or_specification";
  if (
    path.startsWith("docs/product/") ||
    path.startsWith("docs/decisions/") ||
    path.startsWith("docs/roadmap/")
  )
    return "product_or_decision";
  if (
    /(?:^|\/)(?:test|tests|__tests__)\//u.test(path) ||
    path.startsWith(".github/workflows/") ||
    path.startsWith("scripts/check-")
  )
    return "executable_verification";
  return null;
}

export function sourceResponsibilityForPath(path: string): CanonicalizationResponsibility | null {
  const canonical = canonicalResponsibilityForPath(path);
  if (canonical !== null) return canonical;
  if (path.startsWith(".lervo/state/") || path.startsWith("docs/knowledge/")) return null;
  if (
    path === "CLAUDE.md" ||
    path.startsWith(".claude/") ||
    path.startsWith(".codex/") ||
    path.startsWith(".github/instructions/")
  )
    return "behavioral_instruction";
  if (path === "HANDOFF.md") return "mutable_continuation";
  if (
    path.startsWith("apps/") ||
    path.startsWith("packages/") ||
    path.startsWith("src/") ||
    path.startsWith("config/") ||
    /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|swift|cs|cpp|cc|c|h)$/u.test(path) ||
    /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|[^/]+\.config\.[cm]?[jt]s)$/u.test(path)
  )
    return "architecture_or_specification";
  return null;
}

export function recommendedCanonicalRoot(responsibility: CanonicalizationResponsibility): string {
  if (responsibility === "behavioral_instruction") return "docs/instructions";
  if (responsibility === "architecture_or_specification") return "docs/specs";
  if (responsibility === "product_or_decision") return "docs/decisions";
  if (responsibility === "executable_verification") return "tests";
  return ".lervo/state/workstreams";
}
